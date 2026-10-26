import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { namesOf, textTest } from "../src/code/candidates.ts";
import { projectWith, readingIn } from "./reading.ts";

const outdir = "/p/src/lib/grai";

describe("the names a specifier of grai's output must write", () => {
	it("names the output's directory and each barrel, an index by its folder", () => {
		const barrels = new Set(["/p/src/lib/i18n.ts", "/p/src/locale/index.ts"]);

		expect(namesOf({ outdir, barrels }, [], [], [])).toEqual(
			new Set(["grai", "i18n", "locale"]),
		);
	});

	it("names a mapping's key where it may name the output without the specifier writing its name", () => {
		const names = namesOf(
			{ outdir, barrels: new Set() },
			[
				{ key: "@i18n", targets: [`${outdir}/messages.js`] },
				{ key: "$lib/*", targets: ["/p/src/lib/*"] },
				{ key: "#k/*", targets: [`${outdir}/keys.js`] },
				{ key: "@g/*", targets: [`${outdir}/*`] },
				{ key: "#pkg", targets: ["some-package"] },
				{ key: "@t/*", targets: ["/p/src/*/messages.js"] },
				{ key: "@s/*", targets: ["/p/src/lib/gr*"] },
				{ key: "@other", targets: ["/p/src/other.ts"] },
			],
			[],
			[],
		);

		expect(names).toEqual(
			new Set(["grai", "@i18n", "#k/", "@g/", "#pkg", "@t/", "@s/"]),
		);
	});

	it("leaves no name to test when a mapping may name the output from any specifier", () => {
		const mappings = [{ key: "*", targets: [`${outdir}/*`] }];

		expect(namesOf({ outdir, barrels: new Set() }, mappings, [], [])).toBe(
			undefined,
		);
	});

	it("names a symlink into the output, and a package that holds it", () => {
		const names = namesOf(
			{ outdir, barrels: new Set() },
			[],
			[
				{ path: "/p/src/i18n", real: outdir },
				{ path: "/p/src/code", real: "/p/src" },
			],
			[
				{ name: "@app/web", directory: "/p" },
				{ name: "@app/ui", directory: "/ui" },
			],
		);

		expect(names).toEqual(new Set(["grai", "i18n", "@app/web"]));
	});

	it("takes a text that writes a name, an escape in a string, or a load or a glob by a built path, and no load by a whole string", () => {
		const test = textTest(new Set(["grai"]));
		const taken = [
			'import { m } from "./lib/grai/messages.js";',
			'import { m } from "./lib/gr\\u0061i/messages.js";',
			`const load = (name) => import(\`./\${name}.js\`);`,
			"const load = (name) => import /* split */ (name);",
			'const lib = require ("./lib" + name);',
			'const pages = import.meta.glob<Page>("./pages/*.ts");',
		];
		const left = [
			'import { format } from "./lib/format.js";\nconst global = "glob";',
			'const lib = await import("./lib/format.js");',
			"const text = 'a\\nb';",
		];

		expect(taken.map((text) => test.test(text))).toEqual(taken.map(() => true));
		expect(left.map((text) => test.test(text))).toEqual([false, false, false]);
	});
});

describe("a reading of the files that may read grai's messages", () => {
	it("reads the files that name the output, then those that name a barrel of it, and no other", async () => {
		const dir = projectWith({
			"src/a.ts": 'import { m } from "../out/messages.js";\nm.title();\n',
			"src/lib/i18n.ts": 'export { m } from "../../out/messages.js";\n',
			"src/c.ts": 'import { m } from "./lib/i18n.ts";\nm.title();\n',
			"src/d.ts": 'import { a } from "./a.ts";\nexport const d = a;\n',
		});

		expect(await readingIn(dir)).toEqual({
			read: ["src/a.ts", "src/c.ts", "src/lib/i18n.ts"],
			reads: ["src/a.ts title", "src/c.ts title"],
		});
	});

	it("reads a file that names the output by a Vite alias, a tsconfig path or a package.json import", async () => {
		const dir = projectWith({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "~t": ["./out/messages.js"] } },
			}),
			"package.json": JSON.stringify({
				type: "module",
				imports: { "#k/*": "./out/keys.js" },
			}),
			"src/a.ts": 'import { m } from "@i18n";\nm.title();\n',
			"src/b.ts": 'import { m } from "~t";\nm.title();\n',
			"src/c.ts": 'import { title } from "#k/title.js";\ntitle();\n',
			"src/d.ts": "export const d = 1;\n",
		});
		// The alias names the output's module by its path, as a Vite config writes it.
		const messages = JSON.stringify(join(dir, "out/messages.js"));
		writeFileSync(
			join(dir, "vite.config.js"),
			`export default { resolve: { alias: { "@i18n": ${messages} } } };\n`,
		);

		expect(await readingIn(dir)).toEqual({
			read: ["src/a.ts", "src/b.ts", "src/c.ts"],
			reads: ["src/a.ts title", "src/b.ts title", "src/c.ts title"],
		});
	});

	it("reads a file that names the output through a symlink of its own name", async () => {
		const dir = projectWith({
			"src/a.ts": 'import { m } from "./i18n/messages.js";\nm.title();\n',
		});
		symlinkSync(join(dir, "out"), join(dir, "src/i18n"));

		expect((await readingIn(dir)).reads).toEqual(["src/a.ts title"]);
	});

	it("reads a file that names a workspace package outside the project, which passes the output on", async () => {
		const dir = projectWith({
			"src/a.ts": 'import { m } from "@ws/i18n";\nm.title();\n',
			"src/d.ts":
				'import { other } from "@ws/other";\nexport const d = other;\n',
		});
		const workspace = realpathSync(mkdtempSync(join(tmpdir(), "grai-ws-")));
		onTestFinished(() => rmSync(workspace, { recursive: true, force: true }));
		const packages = {
			i18n: `export { m } from ${JSON.stringify(join(dir, "out/messages.js"))};\n`,
			other: "export const other = 1;\n",
		};
		mkdirSync(join(dir, "node_modules/@ws"), { recursive: true });
		for (const [name, index] of Object.entries(packages)) {
			mkdirSync(join(workspace, name));
			writeFileSync(
				join(workspace, name, "package.json"),
				JSON.stringify({
					name: `@ws/${name}`,
					type: "module",
					main: "index.js",
				}),
			);
			writeFileSync(join(workspace, name, "index.js"), index);
			symlinkSync(join(workspace, name), join(dir, "node_modules/@ws", name));
		}

		expect(await readingIn(dir)).toEqual({
			read: ["src/a.ts"],
			reads: ["src/a.ts title"],
		});
	});

	it("reads every file when a Vite alias is a pattern, which may name the output from any specifier", async () => {
		const dir = projectWith({
			"vite.config.js":
				"export default { resolve: { alias: [{ find: /^@t$/, replacement: 'x' }] } };\n",
			"src/a.ts": 'import { m } from "../out/messages.js";\nm.title();\n',
			"src/d.ts": "export const d = 1;\n",
		});

		expect((await readingIn(dir)).read).toEqual(["src/a.ts", "src/d.ts"]);
	});
});
