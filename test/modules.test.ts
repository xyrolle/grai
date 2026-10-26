import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { deserialize, serialize } from "node:v8";
import { describe, expect, it, onTestFinished } from "vitest";
import { factsOf } from "../src/code/facts.ts";
import { readerVersion } from "../src/code/facts-cache.ts";
import { factsOfFiles } from "../src/code/facts-pool.ts";
import { type ProjectCode, readProjectCode } from "../src/code/project.ts";
import { type Config, readConfig } from "../src/config.ts";
import { GraiError } from "../src/error.ts";

/** A project on disk with these files, and its config. */
function projectWith(files: Record<string, string>) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-modules-")));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const all = {
		"grai.config.json": JSON.stringify({
			locales: ["en"],
			baseLocale: "en",
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
		"messages/en.json": JSON.stringify({ title: "Title" }),
		"out/messages.js": 'export * as m from "./keys.js";\n',
		"out/keys.js": 'export const title = () => "Title";\n',
		...files,
	};
	for (const [path, text] of Object.entries(all)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	return { dir, config: readConfig(join(dir, "grai.config.json")) };
}

/** A project's code, which the test expects to resolve. */
async function codeOf(config: Config, dir: string): Promise<ProjectCode> {
	const code = await readProjectCode(config, [join(dir, "src")]);
	if (code instanceof GraiError) throw code;
	return code;
}

describe("the module graph", () => {
	it("follows a name through re-exports, aliases and namespace objects, resolved as the bundler resolves them", async () => {
		const { dir, config } = projectWith({
			"package.json": JSON.stringify({
				imports: {
					"#i18n/messages/*": "./out/keys.js",
					"#lib/*": "./src/lib/*",
				},
			}),
			".svelte-kit/tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "$lib/*": ["../src/lib/*"] } },
			}),
			"tsconfig.json": JSON.stringify({
				extends: "./.svelte-kit/tsconfig.json",
			}),
			"src/lib/i18n.ts": 'export { m } from "../../out/messages.js";\n',
			"src/lib/explicit.ts":
				'export * from "./i18n.ts";\nexport const m = 2;\n',
			"src/lib/star.ts": 'export * from "./i18n.ts";\n',
			"src/lib/alias.ts":
				'import { m } from "./i18n.ts";\nexport const t = m;\nexport default m;\n',
			"src/lib/object.ts":
				'export * as messages from "../../out/messages.js";\n',
			"src/app.ts": "",
		});
		writeFileSync(
			join(dir, "vite.config.js"),
			`export default { resolve: { alias: { "@i18n": ${JSON.stringify(join(dir, "src/lib/i18n.ts"))} } } };\n`,
		);
		const { graph } = await codeOf(config, dir);
		const app = join(dir, "src/app.ts");
		const of = (source: string, name: string) =>
			graph.imported(app, source, name);

		expect(await of("#lib/i18n.ts", "m")).toEqual({ kind: "namespace" });
		expect(await of("$lib/i18n.ts", "m")).toEqual({ kind: "namespace" });
		expect(await of("@i18n", "m")).toEqual({ kind: "namespace" });
		expect(await of("#i18n/messages/title.js", "title")).toEqual({
			kind: "key",
			key: "title",
		});
		// A key's path is that key's module alone, as a build resolves it: through keys.js, its
		// namespace object would hold every key.
		const own = await of("#i18n/messages/title.js", "*");
		expect(own).toEqual({ kind: "module", path: "\0grai:key/title" });
		expect(await of("#i18n/messages/title.js", "subtitle")).toBeUndefined();
		expect(
			own === undefined ? undefined : await graph.member(own, "subtitle"),
		).toBeUndefined();
		expect(await of("./lib/star.ts", "m")).toEqual({ kind: "namespace" });
		expect(await of("./lib/explicit.ts", "m")).toBeUndefined();
		expect(await of("./lib/alias.ts", "t")).toEqual({ kind: "namespace" });
		expect(await of("./lib/alias.ts", "default")).toEqual({
			kind: "namespace",
		});
		const object = await of("./lib/object.ts", "messages");
		expect(object).toEqual({
			kind: "module",
			path: join(dir, "out/messages.js"),
		});
		expect(
			object === undefined ? undefined : await graph.member(object, "m"),
		).toEqual({ kind: "namespace" });
		expect(await of("./lib/missing.ts", "m")).toBeUndefined();
	});
});

describe("resolving as the bundler resolves", () => {
	it("applies the project's tsconfig paths to a component its include does not list, as the framework's bundler does", async () => {
		const { dir, config } = projectWith({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "@/*": ["./src/*"] } },
				include: ["src/**/*.ts"],
			}),
			"src/lib/i18n.ts": 'export { m } from "../../out/messages.js";\n',
			"src/app.ts": "",
		});
		const { graph } = await codeOf(config, dir);

		for (const importer of ["src/app.ts", "src/A.svelte", "src/a.astro"]) {
			expect(
				await graph.imported(join(dir, importer), "@/lib/i18n.ts", "m"),
			).toEqual({ kind: "namespace" });
		}
	});

	it("fails, naming the config, when the tsconfig extends a file not generated yet or the Vite config does not load", async () => {
		const unsynced = projectWith({
			"tsconfig.json": JSON.stringify({
				extends: "./.svelte-kit/tsconfig.json",
			}),
			"src/app.ts": 'import { m } from "../out/messages.js";\n',
		});
		const broken = projectWith({
			"vite.config.js":
				'import plugin from "./missing-plugin.js";\nexport default { plugins: [plugin()] };\n',
			"src/app.ts": "",
		});

		const failure = async ({ dir, config }: typeof unsynced) => {
			const code = await readProjectCode(config, [join(dir, "src")]);
			return code instanceof GraiError
				? `${code.code}: ${code.file}`
				: "resolved";
		};
		expect(await failure(unsynced)).toBe("resolution-invalid: tsconfig.json");
		expect(await failure(broken)).toBe("resolution-invalid: vite.config.js");
	});
});

describe("reading a project's facts", () => {
	it("keeps each file's facts on disk, takes them while its text is the same, and drops a file gone", async () => {
		const { dir, config } = projectWith({
			"src/a.ts": 'import { m } from "../out/messages.js";\nm.title();\n',
			"src/b.ts": "export const b = 1;\n",
		});
		const cache = join(dir, "out/.grai/facts");
		await codeOf(config, dir);
		const saved: {
			version: string;
			entries: [string, { hash: string; facts: unknown }][];
		} = deserialize(readFileSync(cache));
		expect(saved.entries.map(([path]) => path).sort()).toEqual([
			join(dir, "src/a.ts"),
			join(dir, "src/b.ts"),
		]);

		// A cached entry stands for its file while the file's text is the one it was read from.
		const planted = {
			modules: [
				{
					imports: [],
					exports: [{ exported: "planted", local: "planted" }],
					loads: [],
					uses: [],
					aliases: {},
				},
			],
		};
		writeFileSync(
			cache,
			serialize({
				...saved,
				entries: saved.entries.map(([path, entry]) => [
					path,
					path.endsWith("b.ts") ? { ...entry, facts: planted } : entry,
				]),
			}),
		);
		rmSync(join(dir, "src/a.ts"));
		const { sources } = await codeOf(config, dir);

		expect(sources.get(join(dir, "src/b.ts"))?.facts).toEqual(planted);
		const kept: { entries: [string, unknown][] } = deserialize(
			readFileSync(cache),
		);
		expect(kept.entries.map(([path]) => path)).toEqual([join(dir, "src/b.ts")]);
	});

	it("keys the facts on the reader's own code, so a change to it reads every file again, released or not", () => {
		const { dir } = projectWith({
			"reader/facts.js": "export const facts = 1;\n",
			"reader/uses.js": "export const uses = 1;\n",
		});
		const reader = join(dir, "reader");
		const before = readerVersion(reader);

		expect(readerVersion(reader)).toBe(before);
		writeFileSync(join(reader, "uses.js"), "export const uses = 2;\n");
		expect(readerVersion(reader)).not.toBe(before);
	});

	it("reads files in a pool of workers into the same facts as on one thread", async () => {
		// Enough work for the pool to start: each file reads many keys.
		const reads = Array.from({ length: 400 }, (_, n) => `m.key_${n}();`).join(
			"\n",
		);
		const files = Array.from({ length: 1500 }, (_, n) => ({
			path: `src/m${n}.ts`,
			text: `import { m } from "./i18n";\n${reads}\nexport const v${n} = 1;\n`,
		}));
		const inline = [];
		for (const { path, text } of files) inline.push(await factsOf(path, text));

		expect(await factsOfFiles(files)).toEqual(inline);
	});
});
