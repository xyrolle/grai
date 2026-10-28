import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import {
	compilerModules,
	compilerModulesFile,
} from "../src/compiler-identity.ts";
import { project } from "./project.ts";

const source = fileURLToPath(new URL("../src/", import.meta.url));
/** grai as built, which the gate builds before the tests. */
const built = fileURLToPath(new URL("../dist/", import.meta.url));

/**
 * A start as a dev server's, in a process of its own, of grai in `directory`, its modules with
 * `extension`: it takes up the saved build, compiles, saves the build and takes it up again. Every
 * module of grai's it loads, as Node resolves them, and whether it loads oxc's parser.
 */
function start(
	directory: string,
	extension: string,
	config: string,
): { loaded: string[]; parses: boolean } {
	const module = (name: string) =>
		JSON.stringify(pathToFileURL(join(directory, `${name}${extension}`)).href);
	const script = `
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
const loaded = new Set();
let parses = false;
registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		if (resolved.url.startsWith(${JSON.stringify(pathToFileURL(directory).href)})) loaded.add(fileURLToPath(resolved.url));
		if (specifier === "oxc-parser") parses = true;
		return resolved;
	},
});
const { recompile } = await import(${module("compile")});
const { saveBuild, savedBuild } = await import(${module("saved-build")});
const config = process.argv[1];
const options = { pseudoLocale: true };
const { build } = await recompile(config, await savedBuild(config, options), options);
await saveBuild(build);
await recompile(config, await savedBuild(config, options), options);
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

it("is made of the modules a compile and its saved build load, every one and no other", async () => {
	const { config } = project(catalogs);
	const modules = new Set(
		[...((await compilerModules())?.keys() ?? [])].map((module) =>
			join(source, module),
		),
	);

	expect(new Set(start(source, ".ts", config).loaded)).toEqual(modules);
	expect(modules.has(join(source, "cli.ts"))).toBe(false);
});

it("is made, as built, of the modules its build lists, which a start hashes and parses none of", () => {
	const { config } = project(catalogs);
	const listed: Record<string, string> = JSON.parse(
		readFileSync(join(built, compilerModulesFile), "utf8"),
	);
	const modules = new Set(
		Object.keys(listed).map((module) => join(built, module)),
	);
	// The parser is one of them, as the module that finds them imports it, though a start that
	// parses nothing does not load it.
	const parser = join(built, "code", "parse.js");
	const { loaded, parses } = start(built, ".js", config);

	expect(parses).toBe(false);
	expect(new Set([...loaded, parser])).toEqual(modules);
	expect(loaded).not.toContain(parser);
});
