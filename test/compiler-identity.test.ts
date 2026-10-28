import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { compilerModules } from "../src/compiler-identity.ts";
import { project } from "./project.ts";

const source = fileURLToPath(new URL("../src/", import.meta.url));

/**
 * A start as a dev server's, in a process of its own: it takes up the saved build, compiles, saves
 * the build and takes it up again. Every module of grai's source it loads, as Node resolves them,
 * and whether it loads oxc's parser.
 */
function start(config: string): { loaded: string[]; parses: boolean } {
	const script = `
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
const loaded = new Set();
let parses = false;
registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		if (resolved.url.startsWith(${JSON.stringify(pathToFileURL(source).href)})) loaded.add(fileURLToPath(resolved.url));
		if (specifier === "oxc-parser") parses = true;
		return resolved;
	},
});
const { recompile } = await import(${JSON.stringify(pathToFileURL(join(source, "compile.ts")).href)});
const { saveBuild, savedBuild } = await import(${JSON.stringify(pathToFileURL(join(source, "saved-build.ts")).href)});
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

it("is made of the modules a compile and its saved build load, every one and no other", async () => {
	const { config } = project({
		en: { title: "Title", greeting: "Hello {name}" },
		de: { title: "Titel", greeting: "Hallo {name}" },
	});
	const modules = new Set(
		[...((await compilerModules())?.keys() ?? [])].map((module) =>
			join(source, module),
		),
	);

	expect(new Set(start(config).loaded)).toEqual(modules);
	expect(modules.has(join(source, "cli.ts"))).toBe(false);
});
