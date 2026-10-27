import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "oxc-parser";
import { rolldown } from "rolldown";
import { expect, it } from "vitest";
import { project } from "./project.ts";

const catalogs = {
	en: {
		title: "Title",
		greeting: "Hello {name}",
		items: [
			{
				declarations: ["input count", "local countPlural = count: plural"],
				selectors: ["countPlural"],
				match: {
					"countPlural=one": "{count} item",
					"countPlural=*": "{count} items",
				},
			},
		],
		price: "{amount :number style=currency currency=EUR}",
		terms: "Read the {#link}terms{/link}",
	},
	de: {
		title: "Titel",
		greeting: "Hallo {name}",
		items: [
			{
				declarations: ["input count", "local countPlural = count: plural"],
				selectors: ["countPlural"],
				match: {
					"countPlural=one": "{count} Artikel",
					"countPlural=*": "{count} Artikel",
				},
			},
		],
		price: "{amount :number style=currency currency=EUR}",
		terms: "Lies die {#link}Bedingungen{/link}",
	},
};

/** Every file of an output's JavaScript, by its path from the outdir, grai's own state left out. */
function outputModules(out: string): string[] {
	return readdirSync(out, { recursive: true, encoding: "utf8" }).filter(
		(file) => file.endsWith(".js") && !file.startsWith(".grai"),
	);
}

/** The specifiers a module imports and re-exports from, and those of its dynamic imports. */
function specifiers(file: string, text: string): string[] {
	const { module } = parseSync(file, text);
	return [
		...module.staticImports.map((entry) => entry.moduleRequest.value),
		...module.staticExports.flatMap((entry) =>
			entry.entries.flatMap((each) =>
				each.moduleRequest === null ? [] : [each.moduleRequest.value],
			),
		),
		...module.dynamicImports.map(({ moduleRequest }) =>
			text.slice(moduleRequest.start, moduleRequest.end),
		),
	];
}

it("declares the outdir's modules ES modules, server.js the only one with effects of its own", async () => {
	const { dir, compile } = project(catalogs);
	expect((await compile()).errors).toEqual([]);

	expect(
		JSON.parse(readFileSync(join(dir, "out", "package.json"), "utf8")),
	).toEqual({
		type: "module",
		sideEffects: ["./server.js"],
	});
});

it("names no module the outdir's package.json could resolve: each import is relative, or a builtin of Node's", async () => {
	const { dir, compile } = project(catalogs);
	expect((await compile()).errors).toEqual([]);
	const out = join(dir, "out");

	const named = outputModules(out).flatMap((file) =>
		specifiers(file, readFileSync(join(out, file), "utf8")).map(
			(specifier) => ({ file, specifier }),
		),
	);

	expect(named.length).toBeGreaterThan(0);
	expect(
		named.filter(
			({ specifier }) =>
				!/^\.\.?\//.test(specifier) && !specifier.startsWith("node:"),
		),
	).toEqual([]);
});

it("loads the same words in Node from a CommonJS project and an ES module one, without a warning", async () => {
	for (const type of [undefined, "module"]) {
		const { dir, compile } = project(catalogs);
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ name: "app", type }),
		);
		expect((await compile()).errors).toEqual([]);
		const loaded = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`const { m } = await import("./out/messages.js");
const { withLocale } = await import("./out/server.js");
console.log(withLocale("de", () => [m.greeting({ name: "Ana" }), m.items({ count: 2 })].join(" / ")));`,
			],
			{ cwd: dir, encoding: "utf8" },
		);

		expect(loaded.stderr, `type ${type}`).toBe("");
		expect(loaded.stdout).toBe("Hallo Ana / 2 Artikel\n");
	}
});

/** A bundle of an entry that imports the output's keys, as a bundler that reads `sideEffects` makes it. */
async function bundled(out: string, entry: string): Promise<string> {
	const bundle = await rolldown({
		input: "entry",
		cwd: out,
		plugins: [
			{
				name: "entry",
				resolveId: (id) => (id === "entry" ? id : null),
				load: (id) => (id === "entry" ? entry : null),
			},
		],
		logLevel: "silent",
	});
	const { output } = await bundle.generate({ format: "esm" });
	await bundle.close();
	return output
		.map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
		.join("");
}

it("keeps the module of a key the code calls, its check with it, and leaves out every other module of keys", async () => {
	// Enough keys for several modules of them.
	const keys = Array.from({ length: 1200 }, (_, index) => `key${index}`);
	const words = (locale: string) =>
		Object.fromEntries(keys.map((key) => [key, `${locale} ${key}`]));
	const { dir, compile } = project({ en: words("en"), de: words("de") });
	expect((await compile()).errors).toEqual([]);
	const out = join(dir, "out");
	const modulesOfKeys = outputModules(out).filter((file) =>
		file.startsWith("keys/"),
	);
	expect(modulesOfKeys.length).toBeGreaterThan(1);

	const code = await bundled(
		out,
		`import * as m from ${JSON.stringify(join(out, "keys.js"))};\nconsole.log(m.key7());\n`,
	);

	expect(code).toContain('"en key7"');
	// Each module of keys checks the runtime as it loads: the bundle keeps the one it needs.
	expect(code.match(/assertCompiledFor\(\[/g)).toHaveLength(1);
});
