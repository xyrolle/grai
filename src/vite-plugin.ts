import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { type Build, recompile } from "./compile.ts";
import { readConfig } from "./config.ts";
import { devModule } from "./dev-module.ts";
import { messagesOf } from "./error.ts";
import {
	isMessageModule,
	keyModulePrefix,
	keyPrefix,
	outputPrefix,
	textModulePrefix,
	textPrefix,
} from "./locale-chunks.ts";
import { moduleOf } from "./message-imports.ts";
import { shippedMissingKeyCalls } from "./missing-key-calls.ts";
import { realPath } from "./real-path.ts";
import {
	chunkFileName,
	keyModule,
	keysModule,
	messageChunkCopies,
	messageChunking,
	textModule,
} from "./vite-build.ts";
import {
	followedFile,
	keyFromKeys,
	type ProjectFiles,
	patchPrefix,
	pathKey,
	serveMessages,
} from "./vite-dev.ts";

/**
 * The plugin's options:
 * - `config`: the path of the project's grai.config.json, from Vite's root.
 * - `reloadOnEdit`: in dev, reload the open pages after an edit rather than patch them in place,
 *   having sent the servers their patch first. For a framework whose pages the server draws and
 *   no client code could draw again, such as Astro's.
 * - `localeChunks`: in the client build, write a copy of each message chunk per locale, beside
 *   it, with only that locale's words. For an adapter that points each page at its locale's
 *   copies, as `grai/sveltekit`'s `handleLocale` does; nothing else reads them, so they are off by
 *   default.
 */
export type GraiOptions = {
	config?: string;
	reloadOnEdit?: boolean;
	localeChunks?: boolean;
};

/** grai's Vite plugin, and the build its last compile made, for the adapters built on it. */
export type GraiPlugin = { plugin: Plugin; build: () => Build | undefined };

/** grai's Vite plugin (`vite.ts` says what it does), with its build. */
export function graiPlugin(options: GraiOptions): GraiPlugin {
	let files: ProjectFiles = { configFile: "", outdir: "", keysFile: "" };
	let serving = false;
	/** Whether Vite runs tests, as Vitest has it, where a module is what a test can mock. */
	let testing = false;
	let build: Build | undefined;
	/** The first compile: its build, or the errors that kept it from one. */
	let first: Promise<Build | readonly Error[]> | undefined;
	let devModuleOf: (id: string) => string | undefined = () => undefined;
	let missingKeyImport = (
		_key: string,
		_importer: string,
	): string | undefined => undefined;
	/** The places the shipped sources name a key no catalog has, found once for every environment. */
	let missingCalls: readonly Error[] | undefined;
	let closeMessages = async () => {};
	const copies = messageChunkCopies();
	const building = (environment: { name: string } | undefined) =>
		!serving && environment?.name === "client";
	/** Whether this build writes each message chunk's copies, one per locale. */
	const copying = (environment: { name: string } | undefined) =>
		options.localeChunks === true && building(environment);
	/**
	 * keys.js, a key's module or a text key's string module, from the compiler's model, for the
	 * browser or a server.
	 */
	const moduleCode = (
		id: string,
		compiled: Build,
		consumer: "client" | "server",
	) => {
		if (id.startsWith(textModulePrefix)) return textModule(compiled, id);
		if (id === files.keysFile)
			return serving ? devModule(files.outdir, compiled) : keysModule(compiled);
		return serving
			? keyFromKeys(files, id.slice(keyModulePrefix.length))
			: keyModule(compiled, id, consumer);
	};

	const plugin: Plugin = {
		name: "grai",
		config(config, environment) {
			// Real paths, as the bundler names modules: a project reached through a symlink would
			// otherwise match none of its own module ids.
			const configFile = realPath(
				resolve(config.root ?? "", options.config ?? "grai.config.json"),
			);
			const outdir = realPath(readConfig(configFile).outdir);
			files = { configFile, outdir, keysFile: join(outdir, "keys.js") };
			serving = environment.command === "serve";
			testing = environment.mode === "test";
		},
		configEnvironment(name) {
			return !serving && name === "client"
				? messageChunking(files.outdir)
				: undefined;
		},
		outputOptions(output) {
			if (!building(this.environment)) return null;
			const named = output.chunkFileNames;
			return {
				...output,
				chunkFileNames: (chunk) =>
					chunkFileName(
						chunk.moduleIds,
						typeof named === "function"
							? named(chunk)
							: (named ?? "[name]-[hash].js"),
					),
			};
		},
		renderChunk(code, chunk) {
			if (copying(this.environment)) {
				copies.render(
					chunk.fileName,
					chunk.moduleIds,
					code,
					build?.config.locales ?? [],
				);
			}
			return null;
		},
		generateBundle(_, bundle) {
			if (!copying(this.environment)) return;
			const chunks = Object.values(bundle).filter(
				(file) => file.type === "chunk",
			);
			copies.emit(
				chunks,
				this.environment.config.build.minify !== false,
				(fileName, source) =>
					this.emitFile({ type: "asset", fileName, source }),
			);
		},
		async buildStart() {
			if (serving) return;
			first ??= recompile(files.configFile, undefined, {
				localeCopies: options.localeChunks === true,
			}).then(({ result, build: next }) => {
				build = next;
				return next ?? result.errors;
			});
			const compiled = await first;
			if (!("compilation" in compiled)) this.error(messagesOf(compiled));
			missingCalls ??= shippedMissingKeyCalls(compiled);
			if (missingCalls.length > 0) this.error(messagesOf(missingCalls));
		},
		configureServer(server) {
			let ready: (compiled: Build | readonly Error[]) => void = () => {};
			first = new Promise((resolve) => {
				ready = resolve;
			});
			({
				module: devModuleOf,
				missingKeyImport,
				close: closeMessages,
			} = serveMessages(
				server,
				files,
				{ reloadOnEdit: options.reloadOnEdit === true },
				(compiled) => {
					if ("compilation" in compiled) build = compiled;
					ready(compiled);
				},
			));
		},
		// The dev server calls it as it closes: the compile under way finishes first, so nothing is
		// written into the project once the server has closed.
		async buildEnd() {
			await closeMessages();
		},
		resolveId: {
			// Ahead of Vite's resolver, which keeps a lookup that found nothing until its watcher reports
			// the file: in dev every import waits for the first compile, so none, whatever names the
			// output, looks for it before it exists. A page whose import failed would stay broken.
			order: "pre",
			async handler(id, importer, options) {
				if (id.startsWith(outputPrefix))
					return join(files.outdir, id.slice(outputPrefix.length));
				if (
					id.startsWith(keyPrefix) ||
					id.startsWith(textPrefix) ||
					id.startsWith(patchPrefix)
				)
					return `\0${id}`;
				const compiled = serving ? (build ?? (await first)) : build;
				const module = moduleOf(id);
				if (module.type !== "key" || importer === undefined) return null;
				const resolved = await this.resolve(id, importer, {
					...options,
					skipSelf: true,
				});
				if (resolved?.id !== files.keysFile) return resolved;
				// In dev, Vite's resolver takes a per-key path to keys.js and to its exports alone, so a key
				// no catalog has would fail the page; it gets a module of its own instead.
				const missing = serving
					? missingKeyImport(module.key, importer)
					: undefined;
				if (missing !== undefined) return missing;
				// In a build and in a test run, a key's path that the app maps to keys.js resolves to that
				// key's module alone. Through keys.js, which re-exports every key, the bundler spent 56 s of
				// a server build of 13,000 keys working out which entries reach each key; and a test that
				// mocks the path mocks that key and no other. A dev page keeps keys.js as one module, since
				// a module per key costs it a request each.
				const key =
					(!serving || testing) &&
					compiled !== undefined &&
					"compilation" in compiled
						? pathKey(compiled, id)
						: undefined;
				return key === undefined ? resolved : `\0${keyPrefix}${key}`;
			},
		},
		async load(id) {
			const served = devModuleOf(id);
			if (served !== undefined) return served;
			if (id !== files.keysFile && !isMessageModule(id)) return null;
			const compiled = build ?? (await first);
			if (compiled === undefined) return null;
			if (!("compilation" in compiled)) return this.error(messagesOf(compiled));
			// Without side effects, a build leaves out every key a chunk's code does not use, so a key
			// lands in the chunks of the entries that use it.
			const code = moduleCode(id, compiled, this.environment.config.consumer);
			if (code === undefined) return null;
			// No source map in dev: the module is the compiler's, with no source of its own to map back
			// to, and Vite would inline a map of every line it rewrites, several times the module's size.
			// A build keeps its maps, which tools read to tell what each chunk holds.
			return serving
				? { code, moduleSideEffects: false, map: { mappings: "" } }
				: { code, moduleSideEffects: false };
		},
		hotUpdate({ file }) {
			// The plugin follows the catalogs and the config itself, and its output is its own.
			return followedFile(files, build, file) ? [] : undefined;
		},
	};
	return { plugin, build: () => build };
}
