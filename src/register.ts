/**
 * In Node, a module of its own for each key's path, `…/messages/<key>.js`, which an app's
 * package.json maps to the output's keys.js. Loaded before the app,
 * `node --import @xyrolle/grai/register`. Without it Node resolves every key's path to keys.js, one
 * module for every key: a test that mocks one key's path (node:test's `mock.module`) mocks them
 * all. Grai's Vite plugin gives a build and a test run the same modules, so Node, Vite and Vitest
 * each see a key's path as that key alone.
 *
 * The hooks are Node's synchronous ones, `module.registerHooks`: a release candidate from Node
 * 24.13.1 and 25.4.0, in active development on Node 22.
 */

import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { moduleOf } from "./output-paths.ts";
import { stateDirectory } from "./state-directory.ts";

/** What marks, on keys.js's URL, a key's module: the key after it. */
const keyQuery = "?grai-key=";
/** What marks, on keys.js's URL, the module that reads its keys for the keys' modules. */
const readerQuery = "?grai-keys";

/** Whether a URL is an output's keys.js, by grai's own directory beside it, once per URL. */
const outputKeys = new Map<string, boolean>();
function isOutputKeys(url: string): boolean {
	let known = outputKeys.get(url);
	if (known === undefined) {
		known =
			url.startsWith("file:") &&
			url.endsWith("/keys.js") &&
			existsSync(new URL(`${stateDirectory}/`, url));
		outputKeys.set(url, known);
	}
	return known;
}

/**
 * A key's module: its key, read from keys.js through the output's reader. A key is a module of a
 * few words, as 300 imports by path load 300 of them.
 */
function keyModule(keysUrl: string, key: string): string {
	const name = JSON.stringify(key);
	return `import { read } from ${JSON.stringify(`${keysUrl}${readerQuery}`)};
const message = read(${name});
export { message as ${name} };
`;
}

/**
 * The module that reads a key from keys.js for each key's module, one per output. A key no catalog
 * has fails its import, with what to do, where Node would name only the missing export of keys.js.
 */
function readerModule(keysUrl: string): string {
	return `import * as keys from ${JSON.stringify(keysUrl)};
import { GraiError } from ${JSON.stringify(new URL("runtime.js", keysUrl).href)};
export function read(key) {
	if (key in keys) return keys[key];
	throw new GraiError("key-missing", \`"\${key}" is imported by its path, but no catalog has it. Add it to every catalog, or fix the import.\`);
}
`;
}

registerHooks({
	resolve(specifier, context, nextResolve) {
		const module = moduleOf(specifier);
		const resolved = nextResolve(specifier, context);
		if (module.type !== "key" || !isOutputKeys(resolved.url)) return resolved;
		return {
			url: `${resolved.url}${keyQuery}${module.key}`,
			format: "module",
			shortCircuit: true,
		};
	},
	load(url, context, nextLoad) {
		if (url.endsWith(readerQuery)) {
			const keysUrl = url.slice(0, -readerQuery.length);
			return {
				format: "module",
				source: readerModule(keysUrl),
				shortCircuit: true,
			};
		}
		const at = url.indexOf(keyQuery);
		if (at === -1) return nextLoad(url, context);
		return {
			format: "module",
			source: keyModule(url.slice(0, at), url.slice(at + keyQuery.length)),
			shortCircuit: true,
		};
	},
});
