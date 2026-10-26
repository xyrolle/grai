import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, type LibraryOptions, type Rolldown } from "vite";
import { describe, expect, it } from "vitest";
import { grai } from "../src/vite.ts";
import { project } from "./project.ts";

const catalogs = {
	en: { title: "Title", footer: "Footer" },
	de: { title: "Titel", footer: "Fußzeile" },
};

/** An entry that shows a title and, from a module it imports later, a footer. */
const entry = `import { m } from "./out/messages.js";\ndocument.title = m.title();\nimport("./later.js").then(({ later }) => { document.body.textContent = later(); });\n`;
const later = `import { m } from "./out/messages.js";\nexport const later = () => m.footer();\n`;

/**
 * A browser build of `entries`, with the app's own output options, or as a library of them: the
 * file names of each output's chunks, one list per output.
 */
async function clientBuild(
	entries: Record<string, string>,
	{
		output,
		lib,
	}: {
		output?: Rolldown.OutputOptions | Rolldown.OutputOptions[];
		lib?: Omit<LibraryOptions, "entry">;
	},
) {
	const { dir } = project(catalogs);
	for (const [name, code] of Object.entries({ later, ...entries }))
		writeFileSync(join(dir, `${name}.js`), code);
	const input = Object.fromEntries(
		Object.keys(entries).map((name) => [name, join(dir, `${name}.js`)]),
	);
	const result = await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins: [grai()],
		build: {
			write: false,
			outDir: join(dir, "dist"),
			...(lib && { lib: { ...lib, entry: input } }),
			rolldownOptions: { ...(!lib && { input }), ...(output && { output }) },
		},
	});
	return (Array.isArray(result) ? result : [result]).map((each) =>
		"output" in each
			? each.output
					.filter((file) => file.type === "chunk")
					.map((chunk) => chunk.fileName)
			: [],
	);
}

describe("a browser build's message chunks", () => {
	it("leave an output that splits no code in one file", async () => {
		const outputs = await clientBuild(
			{ page: entry },
			{ output: { codeSplitting: false } },
		);

		expect(outputs.map((files) => files.length)).toEqual([1]);
	});

	it("leave an IIFE in one file, as Vite builds it", async () => {
		const outputs = await clientBuild(
			{ page: entry },
			{ output: { format: "iife" } },
		);

		expect(outputs.map((files) => files.length)).toEqual([1]);
	});

	it("leave a library's IIFE in one file", async () => {
		const outputs = await clientBuild(
			{ page: entry },
			{ lib: { formats: ["iife"], name: "page" } },
		);

		expect(outputs.map((files) => files.length)).toEqual([1]);
	});

	it("join each output the app lists, and add none", async () => {
		const outputs = await clientBuild(
			{ a: entry, b: entry.replace("m.title()", "m.footer()") },
			{ output: [{ format: "es", entryFileNames: "[name].mjs" }] },
		);

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toEqual(expect.arrayContaining(["a.mjs", "b.mjs"]));
	});
});
