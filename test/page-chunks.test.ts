import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, type Rolldown } from "vite";
import { describe, expect, it } from "vitest";
import { ownChunkBytes } from "../src/vite-build.ts";
import { type GraiAdapter, graiPlugin } from "../src/vite-plugin.ts";
import { project } from "./project.ts";

/** A word repeated into a message whose key's module alone reaches `ownChunkBytes`. */
const sized = (word: string) =>
	`${word} `.repeat(Math.ceil(ownChunkBytes / word.length));

/**
 * A client build of `entries`: each module (`entries`, then `modules`) calls the keys it lists,
 * imported by their per-key paths, and imports later a module it lists as `./name.js`. It gives the
 * keys each message chunk holds, and the code each entry loads with its imports.
 */
async function built(
	catalog: Record<string, string>,
	entries: Record<string, readonly string[]>,
	{
		modules = {},
		adapter = () => ({}),
	}: {
		modules?: Record<string, readonly string[]>;
		adapter?: (dir: string) => GraiAdapter;
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
		writeFileSync(
			join(dir, `${name}.js`),
			[
				...keys.map(
					(key) => `import { ${key} } from "#i18n/messages/${key}.js";`,
				),
				`console.log(${keys.map((key) => `${key}()`).join(", ")});`,
				...later.map((module) => `import("${module}");`),
			].join("\n"),
		);
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
		// A set nearer by its entries than the shared one, but whose words two pages would load for
		// nothing: under ownChunkBytes, which Rolldown's merge alone would take.
		const intro = sized("Intro").slice(0, ownChunkBytes / 2);
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
});
