// The production build each library's fixtures go through, as an app's `vite build` makes it:
// Vite, with the library's own plugins and nothing else. grai's are its Vite plugin, or for a
// Svelte page its Svelte plugin, which reads a message without inputs as its string. Paraglide's
// plugin only compiles in a build, so its fixtures import the output it compiles for Vite
// (`paraglideForVite`). i18next, use-intl and the prototype have none. A Svelte page takes
// vite-plugin-svelte beside them, for every library alike.
//
// A server build holds the library's server entry beside the fixtures, so that both share one
// runtime, as an app's server bundle does. A client build is a page's, from its index.html, as
// Vite's guide to server rendering builds one: the files a server serves.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { build } from "vite";
import { graiEntry, graiOutput } from "./grai.mjs";

/**
 * The plugins of `library`'s production build. With `page`, for a Svelte page; with
 * `localeChunks`, grai's client build writes each message chunk's copy per locale, which the
 * page's locale script points it at.
 */
export async function pluginsOf(
	library,
	app,
	{ page = false, localeChunks = false } = {},
) {
	const own =
		library === "grai" ? await graiPlugins(app, page, localeChunks) : [];
	return page ? [...own, svelte()] : own;
}

async function graiPlugins(app, page, localeChunks) {
	const { config } = await graiOutput(app);
	const { grai } = await import(graiEntry(page ? "./svelte" : "./vite"));
	return grai({ config, localeChunks });
}

/**
 * Builds `input`, modules by name, for a server, into `outDir`, where each is `<name>.js`. A module
 * the server loads from node_modules stays outside, as Vite leaves it.
 */
export async function serverBuild(root, outDir, input, plugins) {
	await build({
		root,
		configFile: false,
		logLevel: "silent",
		plugins,
		build: {
			ssr: true,
			outDir,
			emptyOutDir: true,
			rolldownOptions: { input },
		},
	});
}

/** The module a client build's page imports, as its index.html names it. */
export const PAGE_ENTRY = "page.js";

/**
 * Builds the page in `root`, its index.html and the `page.js` it imports, for the browser into
 * `outDir`. The entry is an input of its own too, its exports kept beside what index.html loads
 * (`allow-extension`), so that a bench's script can import what the page imports and add no
 * file to what it loads. Returns the built index.html, the URL path of the built entry, and the
 * code of each script the page holds inline.
 */
export async function clientBuild(root, outDir, plugins) {
	const { output } = await build({
		root,
		configFile: false,
		logLevel: "silent",
		plugins,
		build: {
			outDir,
			emptyOutDir: true,
			rolldownOptions: {
				input: {
					index: join(root, "index.html"),
					page: join(root, PAGE_ENTRY),
				},
				preserveEntrySignatures: "allow-extension",
			},
		},
	});
	const entry = output.find(
		(file) => file.type === "chunk" && file.isEntry && file.name === "page",
	);
	const html = readFileSync(join(outDir, "index.html"), "utf8");
	return {
		html,
		entry: `/${entry.fileName}`,
		inline: [...html.matchAll(inlineScript)].map((match) => match[1]),
	};
}

/** A script a page holds inline, such as grai's locale script: not a module it loads, nor data. */
const inlineScript =
	/<script\b(?![^>]*\bsrc=)(?![^>]*\btype="application\/json")[^>]*>([\s\S]*?)<\/script>/g;
