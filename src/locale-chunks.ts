/** How keys.js imports a key's module in a build, and that module's id. */
export const keyPrefix = "grai:key/";
export const keyModulePrefix: string = `\0${keyPrefix}`;

/**
 * How a client build's component imports a message without inputs as the page's string
 * (`@xyrolle/grai/svelte`), and that string's module id.
 */
export const textPrefix = "grai:text/";
export const textModulePrefix: string = `\0${textPrefix}`;

/**
 * How a build's key and text modules import the output's runtime, plurals and formats: by a prefix
 * of grai's, not by the output's path, so that a module's code, by which the bundler weighs it, is
 * the same wherever the project lives.
 */
export const outputPrefix = "grai:output/";

/** Whether a module holds one key's message, as a function or as the page's string. */
export function isMessageModule(id: string): boolean {
	return id.startsWith(keyModulePrefix) || id.startsWith(textModulePrefix);
}

/**
 * Rolldown's own module of helpers, such as the one that makes the namespace object of a key a page
 * imports later. It holds no words, so a chunk of messages may hold it too.
 */
const bundlerHelpers = "\0rolldown/runtime.js";

/** Whether a chunk holds message modules and nothing else but the bundler's helpers. */
export function messageOnly(moduleIds: readonly string[]): boolean {
	return (
		moduleIds.some(isMessageModule) &&
		moduleIds.every((id) => isMessageModule(id) || id === bundlerHelpers)
	);
}

/**
 * A file put in a directory within its own: `_astro/a.js` with `grai` is `_astro/grai/a.js`.
 * Within it, so that a host serving the bundler's directory as immutable (Astro's `_astro/`,
 * Vite's `assets/`, Kit's `_app/immutable/chunks/`) serves the file so too.
 */
export function inDirectory(fileName: string, directory: string): string {
	const at = fileName.lastIndexOf("/") + 1;
	return `${fileName.slice(0, at)}${directory}/${fileName.slice(at)}`;
}

/**
 * A file put in a sibling of its directory: `_astro/grai/a.js` with `grai-de` is
 * `_astro/grai-de/a.js`. A sibling, so that a file's relative imports work alike from every
 * locale's copy.
 */
export function besideDirectory(fileName: string, directory: string): string {
	const file = fileName.slice(fileName.lastIndexOf("/") + 1);
	const parent = fileName.slice(0, fileName.lastIndexOf("/"));
	const above = parent.slice(0, parent.lastIndexOf("/") + 1);
	return `${above}${directory}/${file}`;
}
