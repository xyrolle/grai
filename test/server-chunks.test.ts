import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, type Rolldown, type SSROptions } from "vite";
import { describe, expect, it } from "vitest";
import { grai } from "../src/vite.ts";
import { project } from "./project.ts";

const catalogs = {
	en: { title: "Title", footer: "Footer" },
	de: { title: "Titel", footer: "Fußzeile" },
};

/** An entry that renders a title and, from a module it imports later, a footer. */
const entry = `import { m } from "./out/messages.js";\nexport const render = async () => m.title() + (await import("./later.js")).later();\n`;
const later = `import { m } from "./out/messages.js";\nexport const later = () => m.footer();\n`;

/**
 * A server build of `entries`, beside `modules` they import, with the app's own `ssr` options and
 * output: the file names of each output's chunks, one list per output.
 */
async function serverBuild(
	entries: Record<string, string>,
	{
		ssr,
		output,
		modules = {},
	}: {
		ssr?: SSROptions;
		output?: Rolldown.OutputOptions | Rolldown.OutputOptions[];
		modules?: Record<string, string>;
	},
) {
	const { dir } = project(catalogs);
	for (const [name, code] of Object.entries({ later, ...modules, ...entries }))
		writeFileSync(join(dir, `${name}.js`), code);
	const result = await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins: [grai()],
		...(ssr && { ssr }),
		build: {
			write: false,
			ssr: true,
			outDir: join(dir, "dist"),
			rolldownOptions: {
				input: Object.fromEntries(
					Object.keys(entries).map((name) => [name, join(dir, `${name}.js`)]),
				),
				...(output && { output }),
			},
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

describe("a server build's message chunks", () => {
	it("leave an output that splits no code in one file", async () => {
		const outputs = await serverBuild(
			{ page: entry },
			{ output: { codeSplitting: false } },
		);

		expect(outputs.map((files) => files.length)).toEqual([1]);
	});

	it("leave a webworker's single entry in one file, as Vite builds it", async () => {
		const outputs = await serverBuild(
			{ page: entry },
			{ ssr: { target: "webworker" } },
		);

		expect(outputs.map((files) => files.length)).toEqual([1]);
	});

	it("join the app's own groups, which come first", async () => {
		const usingUtil = `import { util } from "./util.js";\n${entry}export { util };\n`;
		const outputs = await serverBuild(
			{ a: usingUtil, b: usingUtil.replace("m.title()", "m.footer()") },
			{
				output: {
					codeSplitting: { groups: [{ name: "app", test: /util\.js$/ }] },
				},
				modules: { util: "export const util = () => 1;\n" },
			},
		);
		const named = (name: string) =>
			outputs[0]?.filter((file) => new RegExp(`(^|/)${name}-`).test(file));

		expect([named("app"), named("grai")].map((files) => files?.length)).toEqual(
			[1, 1],
		);
	});

	it("join each output the app lists, and add none", async () => {
		const outputs = await serverBuild(
			{ a: entry, b: entry.replace("m.title()", "m.footer()") },
			{ output: [{ format: "es", entryFileNames: "[name].mjs" }] },
		);

		expect(outputs).toHaveLength(1);
		expect(outputs[0]).toEqual(expect.arrayContaining(["a.mjs", "b.mjs"]));
		expect(outputs[0]?.filter((file) => /(^|\/)grai-/.test(file))).toHaveLength(
			1,
		);
	});
});
