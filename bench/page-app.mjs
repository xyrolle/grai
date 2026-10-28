// The message-heavy page (page.mjs) as a Svelte app built with Vite serves it, after Vite's guide
// to server rendering: an index.html the server draws the page into, an entry the browser hydrates
// from, and one the server renders with, each built with the library's own plugins
// (production.mjs). The browser's entry gives `hydrate`, `mount`, `unmount` and the page, so that
// a bench's script can time them with nothing of its own in what the page loads. The server's
// gives `render`, the page, and the library's server entry, which shares the page's runtime.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./apps.mjs";
import { pageSource } from "./page.mjs";
import {
	clientBuild,
	PAGE_ENTRY,
	pluginsOf,
	serverBuild,
} from "./production.mjs";

/** Where the app's built index.html has the server's head and its page drawn. */
export const APP_HEAD = "<!--app-head-->";
export const APP_HTML = "<!--app-html-->";

/**
 * Writes the app of a variant of the page under `name`: its Svelte page, from the variant's
 * messages (`pageSource`), its index.html in the app's base locale, and both entries. Returns its
 * directory.
 */
export function writePageApp(app, name, variant) {
	const root = join(cacheDir, "page", app.id, name);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, "Page.svelte"), pageSource(app, variant));
	writeFileSync(
		join(root, PAGE_ENTRY),
		`export { hydrate, mount, unmount } from "svelte";\nexport { default as Page } from "./Page.svelte";\n`,
	);
	writeFileSync(
		join(root, "index.html"),
		`<!doctype html><html lang="${app.baseLocale}"><head><meta charset="utf-8">${APP_HEAD}</head><body><div id="app">${APP_HTML}</div><script type="module" src="./${PAGE_ENTRY}"></script></body></html>\n`,
	);
	const server =
		variant.server === undefined
			? ""
			: `export * from ${JSON.stringify(variant.server)};\n`;
	writeFileSync(
		join(root, "server.js"),
		`export { render } from "svelte/server";\nexport { default as Page } from "./Page.svelte";\n${server}`,
	);
	return root;
}

/** The app's server build: the path of its built server entry. */
export async function buildServer(app, root, variant) {
	const outDir = join(root, "dist", "server");
	await serverBuild(
		root,
		outDir,
		{ server: join(root, "server.js") },
		await pluginsOf(variant.library, app, { page: true }),
	);
	return join(outDir, "server.js");
}

/**
 * The app's client build: the directory a server serves, its index.html and the URL path of its
 * entry. grai's build copies its message chunks per locale with the variant's `localeChunks`.
 */
export async function buildClient(app, root, variant) {
	const directory = join(root, "dist", "client");
	const built = await clientBuild(
		root,
		directory,
		await pluginsOf(variant.library, app, {
			page: true,
			localeChunks: variant.localeChunks === true,
		}),
	);
	return { directory, ...built };
}
