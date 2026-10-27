// A page's script: an entry module bundled for the browser into one minified file, by Rolldown,
// or for grai, first built by Vite with grai's plugin, as an app's client build builds it. That
// build puts the page's keys in message chunks of their own, with each locale's copies beside
// them; the page then loads either the chunks as built, every locale in them, as a SvelteKit page
// loads them today, or its locale's copies, as an import map points it at them. The build's files
// are then bundled into one, so every variant is one script and a page times only its work.
import { dirname, posix } from "node:path";
import { rolldown } from "rolldown";
import { build } from "vite";
import { graiEntry, graiModule, graiOutput } from "./grai.mjs";

const { grai: graiPlugin } = await import(graiEntry("./vite"));
const { localeDirectory, messageDirectory } = await import(
	graiModule("message-directories.ts")
);

/** What a Vite build of `entry` with grai's plugin writes: its files' code by name, and the entry's. */
async function graiBuild(app, entry) {
	const { config } = await graiOutput(app);
	const { output } = await build({
		root: dirname(entry),
		configFile: false,
		logLevel: "silent",
		plugins: [graiPlugin({ config, localeChunks: true })],
		build: { write: false, rolldownOptions: { input: entry } },
	});
	const code = new Map(
		output.map((file) => [
			file.fileName,
			file.type === "chunk" ? file.code : String(file.source),
		]),
	);
	const { fileName } = output.find(
		(file) => file.type === "chunk" && file.isEntry,
	);
	return { code, entry: fileName };
}

/** The file a page in `locale` loads for a built file: a message chunk's copy for it, else the file. */
function loadedIn(locale, file) {
	const directory = posix.dirname(file);
	if (locale === undefined || posix.basename(directory) !== messageDirectory)
		return file;
	const parent = posix.dirname(directory);
	return posix.join(parent, localeDirectory(locale), posix.basename(file));
}

/** A Rolldown plugin that reads a build's files, each import resolved to the file the page loads. */
function builtFiles({ code }, locale) {
	return {
		name: "grai-build",
		resolveId(source, importer) {
			if (importer === undefined) return source;
			const file = loadedIn(
				locale,
				posix.join(posix.dirname(importer), source),
			);
			if (!code.has(file))
				throw new Error(`${importer} imports ${source}, not in the build`);
			return file;
		},
		load: (id) => code.get(id),
	};
}

/**
 * `entry`, a module's path, as one minified file for the browser. With `grai: { app, locale }`, it
 * is built with grai's plugin first and loads `locale`'s copies of its message chunks, or with no
 * `locale`, the chunks as built.
 */
export async function browserBundle(entry, { banner, grai } = {}) {
	const built = grai && (await graiBuild(grai.app, entry));
	const bundle = await rolldown({
		input: built?.entry ?? entry,
		platform: "browser",
		resolve: { conditionNames: ["production", "browser", "import", "default"] },
		plugins: built ? [builtFiles(built, grai.locale)] : [],
		logLevel: "silent",
	});
	const { output } = await bundle.generate({
		format: "esm",
		minify: true,
		banner,
	});
	await bundle.close();
	return output[0].code;
}
