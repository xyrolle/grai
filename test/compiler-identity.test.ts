import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { type BuiltPart, builtModulesFile } from "../src/compiler-identity.ts";
import { project } from "./project.ts";

/** grai as built, which the gate builds before the tests. */
const built = fileURLToPath(new URL("../dist/", import.meta.url));

/** The chunks grai's build lists for a part of grai, by their paths in dist. */
function listed(part: BuiltPart): string[] {
	const lists: Record<BuiltPart, Record<string, string>> = JSON.parse(
		readFileSync(join(built, builtModulesFile), "utf8"),
	);
	return Object.keys(lists[part]);
}

/**
 * A compile of the project through the package's own entry, `compile` from dist/index.js, in a
 * process of its own: every file of grai's build it loads, by its path in dist, and whether it
 * loads oxc's parser.
 */
function compiled(config: string): { loaded: string[]; parses: boolean } {
	const script = `
import { registerHooks } from "node:module";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
const loaded = new Set();
let parses = false;
registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		if (resolved.url.startsWith(${JSON.stringify(pathToFileURL(built).href)})) loaded.add(relative(${JSON.stringify(built)}, fileURLToPath(resolved.url)));
		if (specifier === "oxc-parser") parses = true;
		return resolved;
	},
});
const { compile } = await import(${JSON.stringify(pathToFileURL(join(built, "index.js")).href)});
await compile(process.argv[1]);
console.log(JSON.stringify({ loaded: [...loaded], parses }));
`;
	const run = spawnSync(
		process.execPath,
		["--input-type=module", "-e", script, config],
		{ encoding: "utf8" },
	);
	expect(run.stderr).toBe("");
	return JSON.parse(run.stdout);
}

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}" },
	de: { title: "Titel", greeting: "Hallo {name}" },
};

it("lists, as built, every chunk a compile loads but the entry it came through, and loads no parser", () => {
	const { config } = project(catalogs);
	const { loaded, parses } = compiled(config);
	const compiler = new Set(listed("compiler"));

	expect(parses).toBe(false);
	expect(loaded).toContain("index.js");
	expect(loaded.filter((file) => !compiler.has(file))).toEqual(["index.js"]);
});

it("lists no entry among the compiler's chunks, as an entry's own code is no compile's", () => {
	const compiler = listed("compiler");

	for (const entry of ["cli.js", "index.js", "vite.js", "next/config.js"])
		expect(compiler).not.toContain(entry);
});
