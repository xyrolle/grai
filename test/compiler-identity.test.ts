import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { compilerModules } from "../src/compiler-identity.ts";
import { project } from "./project.ts";

/**
 * Every module of grai's source a fresh process loads to start from a saved build, compile, save
 * the build and take it up again, as Node resolves them.
 */
function loadedModules(config: string): string[] {
	const source = new URL("../src/", import.meta.url).href;
	const script = `
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
const loaded = new Set();
registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		if (resolved.url.startsWith(${JSON.stringify(source)})) loaded.add(fileURLToPath(resolved.url));
		return resolved;
	},
});
const { recompile } = await import(${JSON.stringify(`${source}compile.ts`)});
const { saveBuild, savedBuild } = await import(${JSON.stringify(`${source}saved-build.ts`)});
const config = process.argv[1];
const options = { pseudoLocale: true };
const { build } = await recompile(config, await savedBuild(config, options), options);
await saveBuild(build);
await recompile(config, await savedBuild(config, options), options);
console.log(JSON.stringify([...loaded]));
`;
	const run = spawnSync(
		process.execPath,
		["--input-type=module", "-e", script, config],
		{ encoding: "utf8" },
	);
	expect(run.stderr).toBe("");
	return JSON.parse(run.stdout);
}

it("is made of the modules a compile and its saved build load, every one and no other", () => {
	const { config } = project({
		en: { title: "Title", greeting: "Hello {name}" },
		de: { title: "Titel", greeting: "Hallo {name}" },
	});

	expect(new Set(compilerModules().keys())).toEqual(
		new Set(loadedModules(config)),
	);
	expect(
		compilerModules().has(
			fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
		),
	).toBe(false);
});
