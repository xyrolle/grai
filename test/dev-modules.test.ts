import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { project } from "./project.ts";

const src = new URL("../src/", import.meta.url).href;

/**
 * grai's modules a fresh process loads, by their paths in src, to start a dev server of the project
 * in `dir` with one of grai's Vite entries and serve the page its keys.js.
 */
function devModules(entry: string, dir: string): string[] {
	const script = `
import { registerHooks } from "node:module";
const loaded = new Set();
registerHooks({
	resolve(specifier, context, nextResolve) {
		const resolved = nextResolve(specifier, context);
		loaded.add(resolved.url);
		return resolved;
	},
});
const { createServer } = await import("vite");
const { grai } = await import(${JSON.stringify(`${src}${entry}`)});
const server = await createServer({
	root: process.argv[1],
	configFile: false,
	logLevel: "silent",
	server: { middlewareMode: true, watch: null },
	plugins: [grai()],
});
await server.environments.client.transformRequest("/out/keys.js");
await server.close();
console.log(JSON.stringify([...loaded]));
`;
	const output = execFileSync(
		process.execPath,
		["--input-type=module", "-e", script, dir],
		{ cwd: fileURLToPath(new URL("..", import.meta.url)), encoding: "utf8" },
	);
	const urls: string[] = JSON.parse(output);
	return urls
		.filter((url) => url.startsWith(src))
		.map((url) => url.slice(src.length));
}

it("starts a dev server without loading the build's code, nor the parser where no page needs the locale script", () => {
	const { dir } = project({ en: { title: "Title" }, de: { title: "Titel" } });

	const kit = devModules("sveltekit-vite.ts", dir);
	expect(kit).toContain("vite-dev.ts");
	expect(kit).not.toContain("vite-build.ts");
	expect(kit).not.toContain("code/build-reading.ts");
	expect(kit).not.toContain("code/parse.ts");

	// A page Vite serves gets the locale script, which reads the runtime's functions with the parser.
	const vite = devModules("vite.ts", dir);
	expect(vite).toContain("locale-script.ts");
	expect(vite).not.toContain("vite-build.ts");
	expect(vite).not.toContain("code/build-reading.ts");
});
