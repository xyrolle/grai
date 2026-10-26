import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { build, type Rolldown } from "vite";
import { describe, expect, it } from "vitest";
import { requestBytes } from "../src/key-sets.ts";
import { type GraiAdapter, graiPlugin } from "../src/vite-plugin.ts";
import { project } from "./project.ts";

/** A word repeated into a message far larger than a request is worth, which no merge takes. */
const sized = (word: string) =>
	`${word} `.repeat(Math.ceil((8 * requestBytes) / word.length));

/**
 * A client build of `entries`: each module (`entries`, then `modules`) calls the keys it lists,
 * imported by their per-key paths, or with `namespace` read through `m`, and imports later a
 * module it lists as `./name.js`; `files` are written as they are, after the modules, so that one
 * can stand for a module's code. It gives the keys each message chunk holds, and the code each entry
 * loads with its imports.
 */
async function built(
	catalog: Record<string, string>,
	entries: Record<string, readonly string[]>,
	{
		modules = {},
		adapter = () => ({}),
		namespace = false,
		files = {},
	}: {
		modules?: Record<string, readonly string[]>;
		adapter?: (dir: string) => GraiAdapter;
		namespace?: boolean;
		files?: Record<string, string>;
	} = {},
) {
	const { dir } = project({ en: catalog, de: catalog });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({ imports: { "#i18n/messages/*": "./out/keys.js" } }),
	);
	for (const [name, uses] of Object.entries({ ...entries, ...modules })) {
		const keys = uses.filter((use) => !use.startsWith("./"));
		const later = uses.filter((use) => use.startsWith("./"));
		const imports = namespace
			? [`import { m } from "./out/messages.js";`]
			: keys.map((key) => `import { ${key} } from "#i18n/messages/${key}.js";`);
		writeFileSync(
			join(dir, `${name}.js`),
			[
				...imports,
				`console.log(${keys.map((key) => `${namespace ? "m." : ""}${key}()`).join(", ")});`,
				...later.map((module) => `import("${module}");`),
			].join("\n"),
		);
	}
	for (const [file, code] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, file)), { recursive: true });
		writeFileSync(join(dir, file), code);
	}
	const output = await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins: [graiPlugin({}, adapter(dir)).plugin],
		build: {
			write: false,
			rolldownOptions: {
				input: Object.fromEntries(
					Object.keys(entries).map((name) => [name, join(dir, `${name}.js`)]),
				),
			},
		},
	});
	const chunks = (Array.isArray(output) ? output : [output])
		.flatMap((result) => ("output" in result ? result.output : []))
		.filter((file): file is Rolldown.OutputChunk => file.type === "chunk");
	const keysOf = chunks
		.filter((chunk) => chunk.fileName.startsWith("assets/grai/"))
		.map((chunk) =>
			chunk.moduleIds.map((id) => id.replace("\0grai:key/", "")).sort(),
		)
		.sort();
	const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
	const loaded = (file: string): string => {
		const chunk = byFile.get(file);
		return chunk === undefined
			? ""
			: chunk.code + chunk.imports.map(loaded).join("");
	};
	const code = Object.fromEntries(
		chunks
			.filter((chunk) => chunk.isEntry)
			.map((chunk) => [chunk.name, loaded(chunk.fileName)]),
	);
	return { keysOf, code };
}

describe("the Vite plugin's chunks by page", () => {
	it("puts the keys the same pages load in one chunk, though different entries of those pages use them", async () => {
		const catalog = {
			menu: sized("Menu"),
			save: sized("Save"),
			article: sized("Article"),
			title: sized("Title"),
		};
		const entries = {
			layout: ["menu", "save"],
			article: ["save", "article"],
			about: ["title"],
		};
		const pages = (dir: string) => ({
			pageEntries: () => [
				[join(dir, "layout.js"), join(dir, "article.js")],
				[join(dir, "layout.js"), join(dir, "about.js")],
			],
		});

		expect((await built(catalog, entries, { adapter: pages })).keysOf).toEqual([
			["article"],
			["menu", "save"],
			["title"],
		]);
		expect((await built(catalog, entries)).keysOf).toEqual([
			["article"],
			["menu"],
			["save"],
			["title"],
		]);
	});

	it("merges two sets of keys when the request it saves outweighs the bytes it loads in vain", async () => {
		// A set nearer by its entries than the shared one, but whose words nine pages would load for
		// nothing.
		const intro = sized("Intro");
		const pages = Array.from({ length: 10 }, (_, index) => `page${index}`);
		const { keysOf, code } = await built(
			{ nav: "Nav", tab: "Tab", intro },
			Object.fromEntries(
				pages.map((page, index) => [
					page,
					[
						"nav",
						...(index < 2 ? ["tab"] : []),
						...(index === 0 ? ["intro"] : []),
					],
				]),
			),
		);

		expect(keysOf).toEqual([["intro"], ["nav", "tab"]]);
		expect(code.page1?.includes("Intro")).toBe(false);
	});

	it("keeps the keys a first paint needs apart from the keys only a later import needs", async () => {
		const { keysOf } = await built(
			{ now: "Now", later: "Later" },
			{ page: ["now", "./later.js"] },
			{ modules: { later: ["later"] } },
		);

		expect(keysOf).toEqual([["later"], ["now"]]);
	});

	it("chunks the keys a module reads through the namespace by the pages that load it, as it chunks a per-key import", async () => {
		const catalog = {
			menu: sized("Menu"),
			save: sized("Save"),
			article: sized("Article"),
			title: sized("Title"),
		};
		const entries = {
			layout: ["menu", "save"],
			article: ["save", "article"],
			about: ["title"],
		};
		const pages = (dir: string) => ({
			pageEntries: () => [
				[join(dir, "layout.js"), join(dir, "article.js")],
				[join(dir, "layout.js"), join(dir, "about.js")],
			],
		});

		expect(
			(await built(catalog, entries, { adapter: pages, namespace: true }))
				.keysOf,
		).toEqual([["article"], ["menu", "save"], ["title"]]);
	});

	it("chunks the keys a module may read by a computed name with the keys of the pages that module is on", async () => {
		const { keysOf } = await built(
			{ shown: "Shown", picked: "Picked", other: "Other" },
			{ list: ["shown"], detail: [] },
			{
				namespace: true,
				files: {
					"detail.js": `import { m } from "./out/messages.js";\nconst name = document.title;\nconsole.log(m[name]());\n`,
				},
			},
		);

		expect(keysOf).toEqual([["other", "picked", "shown"]]);
	});

	it("chunks the keys a module may take apart from the namespace by a computed name or a rest with the keys of its pages", async () => {
		const { keysOf } = await built(
			{ shown: "Shown", picked: "Picked", other: "Other" },
			{ list: ["shown"], detail: [], summary: [] },
			{
				namespace: true,
				files: {
					"detail.js": `import { m } from "./out/messages.js";\nconst { [document.title]: picked } = m;\nconsole.log(picked());\n`,
					"summary.js": `import { m } from "./out/messages.js";\nconst { ...all } = m;\nconsole.log(Object.keys(all));\n`,
				},
			},
		);

		expect(keysOf).toEqual([["other", "picked", "shown"]]);
	});

	it("sees through a module that only re-exports, to the modules that hold what each page takes from it", async () => {
		const group = (name: string, key: string) =>
			`import { m } from "../out/messages.js";\nexport const ${name} = { one: m.${key} };\n`;
		const page = (name: string) =>
			`import { ${name} } from "./groups/index.js";\nconsole.log(${name}.one());\n`;
		const { keysOf, code } = await built(
			{ alpha: sized("Alpha"), beta: sized("Beta") },
			{ first: [], second: [] },
			{
				files: {
					"groups/package.json": JSON.stringify({ sideEffects: false }),
					"groups/alpha.js": group("alphaGroup", "alpha"),
					"groups/beta.js": group("betaGroup", "beta"),
					"groups/index.js": `export { alphaGroup } from "./alpha.js";\nexport * from "./beta.js";\n`,
					"first.js": page("alphaGroup"),
					"second.js": page("betaGroup"),
				},
			},
		);

		expect(keysOf).toEqual([["alpha"], ["beta"]]);
		expect(code.first?.includes("Beta")).toBe(false);
		expect(code.second?.includes("Alpha")).toBe(false);
	});

	it("follows a name through each `export *` it passes, to the module that holds it", async () => {
		const reader = (name: string, key: string) =>
			`import { m } from "../out/messages.js";\nexport function ${name}() { return m.${key}(); }\n`;
		const page = (name: string) =>
			`import { ${name} } from "./groups/index.js";\nconsole.log(${name}());\n`;
		const { keysOf, code } = await built(
			{ alpha: sized("Alpha"), beta: sized("Beta") },
			{ first: [], second: [] },
			{
				files: {
					"groups/package.json": JSON.stringify({ sideEffects: false }),
					"groups/alpha.js": reader("alphaText", "alpha"),
					"groups/beta.js": reader("betaText", "beta"),
					"groups/both.js": `export * from "./alpha.js";\nexport * from "./beta.js";\n`,
					"groups/index.js": `export * from "./both.js";\n`,
					"first.js": page("alphaText"),
					"second.js": page("betaText"),
				},
			},
		);

		expect(keysOf).toEqual([["alpha"], ["beta"]]);
		expect(code.first?.includes("Beta")).toBe(false);
		expect(code.second?.includes("Alpha")).toBe(false);
	});

	it("takes a name a module re-exports by name from that module, not from an `export *` beside it", async () => {
		// Small keys, which a page reading both would merge: the first page reads only alpha.
		const reader = (name: string, key: string) =>
			`import { m } from "../out/messages.js";\nexport function ${name}() { return m.${key}(); }\n`;
		const { keysOf } = await built(
			{ alpha: "Alpha", beta: "Beta" },
			{ first: [], second: [] },
			{
				files: {
					"groups/package.json": JSON.stringify({ sideEffects: false }),
					"groups/alpha.js": reader("text", "alpha"),
					"groups/beta.js": `${reader("text", "beta")}export const other = 1;\n`,
					"groups/index.js": `export { text } from "./alpha.js";\nexport * from "./beta.js";\n`,
					"first.js": `import { text } from "./groups/index.js";\nconsole.log(text());\n`,
					"second.js": `import { m } from "./out/messages.js";\nconsole.log(m.beta());\n`,
				},
				namespace: true,
			},
		);

		expect(keysOf).toEqual([["alpha"], ["beta"]]);
	});
});
