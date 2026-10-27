import { basename, join, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { baseDisagreement, type FrameworkBase } from "./base-agreement.ts";
import { BuildReading } from "./code/build-reading.ts";
import { FactsCache } from "./code/facts-cache.ts";
import { parse } from "./code/parse.ts";
import { withGroups } from "./code-splitting.ts";
import { type Build, recompile } from "./compile.ts";
import { type Config, readConfig } from "./config.ts";
import { devModule } from "./dev-module.ts";
import { GraiError, messagesOf } from "./error.ts";
import {
	isMessageModule,
	keyModulePrefix,
	keyPrefix,
	outputPrefix,
	textModulePrefix,
	textPrefix,
} from "./locale-chunks.ts";
import { type ModuleLinks, moduleLinks, seenThrough } from "./module-links.ts";
import { moduleOf } from "./output-paths.ts";
import { realPath } from "./real-path.ts";
import { sharedKeys } from "./server-chunks.ts";
import { stateDirectory } from "./state-directory.ts";
import {
	type ChunkingGraph,
	chunkFileName,
	keyModule,
	keyPageChunks,
	keysModule,
	messageChunkCopies,
	messageGroups,
	placeholderTexts,
	textModule,
} from "./vite-build.ts";
import {
	devKeysId,
	followedFile,
	keyFromKeys,
	type ProjectFiles,
	patchPrefix,
	pathKey,
	serveMessages,
} from "./vite-dev.ts";
import { pagePreloads } from "./vite-preloads.ts";
import { buildReads, chunkReads } from "./vite-reads.ts";

/**
 * The plugin's options:
 * - `config`: the path of the project's grai.config.json, from Vite's root.
 * - `reloadOnEdit`: in dev, reload the open pages after an edit rather than patch them in place,
 *   having sent the servers their patch first. For a framework whose pages the server draws and
 *   no client code could draw again, such as Astro's.
 * - `localeChunks`: in the client build, write a copy of each message chunk per locale, beside
 *   it, with only that locale's words. For an adapter that points each page at its locale's
 *   copies, as `@xyrolle/grai/sveltekit`'s `handleLocale` does, or for the pages @xyrolle/grai/vite
 *   builds, whose locale script then points each at its locale's copies. Off by default.
 */
export type GraiOptions = {
	config?: string;
	reloadOnEdit?: boolean;
	localeChunks?: boolean;
};

/**
 * grai's Vite plugins, the one that reads each module before any other and the one that does the
 * rest, and the build its last compile made, for the adapters built on them.
 */
export type GraiPlugin = {
	plugins: Plugin[];
	build: () => Build | undefined;
	/** The project's config: as the last compile read it, or as its file has it before any compile. */
	config: () => Config;
	/** A build environment's reading of its modules, which the adapters' transforms share. */
	reading: (environment: string) => BuildReading | undefined;
};

/** The modules whose shipped code links the client build's modules: scripts, and components. */
const scanned = /\.(?:[cm]?[jt]sx?|svelte|vue|astro|mdx)$/;

/**
 * What a framework's adapter tells the plugin:
 * - `pageEntries`: the entries each page's first paint loads together, by their module ids as the
 *   bundler names them (real paths), which the client build chunks keys by. Called once a client
 *   build has loaded every module.
 * - `frameworkBase`: the base path the framework serves the app under, as its config writes it,
 *   which must be grai's `basePath` under the `url` strategy; undefined where it names none.
 */
export type GraiAdapter = {
	pageEntries?: () => Iterable<readonly string[]>;
	frameworkBase?: (config: ResolvedConfig) => FrameworkBase | undefined;
};

/** Vite's own base, for an app Vite alone serves; none for a relative base, which names no path. */
export const viteBase = (config: ResolvedConfig): FrameworkBase | undefined =>
	config.base.startsWith("/")
		? { option: "Vite's base", base: config.base }
		: undefined;

/** grai's Vite plugin (`vite.ts` says what it does), with its build. */
export function graiPlugin(
	options: GraiOptions,
	adapter: GraiAdapter = {},
): GraiPlugin {
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
	/** How many patches the dev server has made: the version of the dev module it serves now. */
	let patchesMade = () => 0;
	/** Each build environment's reading of its modules, from its start. */
	const readings = new Map<string, BuildReading>();
	// The facts of the modules the build reads, kept with the CLI's by their code's hash.
	let facts: FactsCache | undefined;
	let closeMessages = async () => {};
	const copies = messageChunkCopies();
	/**
	 * What the client build read of its modules, for the keys' reach: the keys each reads or may
	 * reach, before any transform; those that may reach any key; and each one's links, from the
	 * code it ships.
	 */
	const read = {
		reads: new Map<string, ReadonlySet<string>>(),
		computed: new Set<string>(),
		modules: new Map<string, ModuleLinks>(),
	};
	/** The client build's imports that change once re-export modules are seen through, at its end. */
	let seen = new Map<string, string[]>();
	/** The client build's chunk of each key it reaches exactly, by the pages that load it. */
	let pageChunks: Map<string, string> | undefined;
	const pageChunkOf = (id: string, graph: ChunkingGraph) => {
		if (build === undefined) return undefined;
		pageChunks ??= keyPageChunks(
			build,
			files.keysFile,
			(module) => graph.getModuleInfo(module),
			{ reads: read.reads, computed: read.computed, imports: seen },
			adapter.pageEntries === undefined
				? undefined
				: [...adapter.pageEntries()],
		);
		return pageChunks.get(id);
	};

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
		if (id.startsWith(textModulePrefix))
			return textModule(compiled, id, consumer);
		if (id === devKeysId || id === files.keysFile)
			return serving
				? devModule(files.outdir, compiled, patchesMade())
				: keysModule(compiled);
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
		configEnvironment(name, environment) {
			if (serving || name !== "client" || options.localeChunks !== true)
				return undefined;
			// With copies, a page's own preloads leave the shared message chunks out, for its locale
			// script to preload the locale's copies.
			const preloads = pagePreloads(environment.build?.modulePreload);
			return preloads === undefined
				? undefined
				: { build: { modulePreload: preloads } };
		},
		configResolved(resolved) {
			const framework = adapter.frameworkBase?.(resolved);
			const problem =
				framework === undefined
					? undefined
					: baseDisagreement(readConfig(files.configFile), framework);
			if (problem !== undefined) {
				throw new GraiError(
					"config-invalid",
					{ file: basename(files.configFile) },
					problem,
				);
			}
		},
		outputOptions(output) {
			// grai's groups join each output as Vite resolved it, and none that splits no code
			// (`code-splitting.ts`).
			if (serving || output.codeSplitting === false) return null;
			if (this.environment.config.consumer === "server")
				return {
					...output,
					codeSplitting: withGroups(output.codeSplitting, [sharedKeys]),
				};
			if (!building(this.environment)) return null;
			const named = output.chunkFileNames;
			return {
				...output,
				codeSplitting: withGroups(
					output.codeSplitting,
					messageGroups(files.outdir, pageChunkOf),
				),
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
			pageChunks = undefined;
			if (building(this.environment)) {
				read.reads.clear();
				read.computed.clear();
				read.modules.clear();
				seen = new Map();
			}
			first ??= recompile(files.configFile, undefined, {
				localeCopies: options.localeChunks === true,
			}).then(({ result, build: next }) => {
				build = next;
				return next ?? result.errors;
			});
			const compiled = await first;
			if (!("compilation" in compiled)) this.error(messagesOf(compiled));
			const held = placeholderTexts(compiled);
			if (held.length > 0) this.error(messagesOf(held));
			facts ??= new FactsCache(join(files.outdir, stateDirectory));
			readings.set(
				this.environment.name,
				new BuildReading(
					compiled.config.root,
					files.outdir,
					// Through grai's own resolveId too, which gives a key's path its key's module.
					(source, importer) =>
						this.resolve(source, importer, { skipSelf: false }).then(
							(resolved) => resolved?.id,
							// A build that ends first drops its resolver: what it can no longer follow is
							// none of grai's, as the bundler reports what it cannot resolve itself.
							() => undefined,
						),
					facts,
				),
			);
		},
		// A module's code as the client build ships it, a component's compiled, tells its chunking what
		// the module links to, globs expanded.
		transform: {
			order: "post",
			filter: { id: { exclude: [/\/node_modules\//, /^\0/] } },
			handler(code, id) {
				if (!building(this.environment) || build === undefined) return null;
				if (
					id.startsWith(files.outdir) ||
					!scanned.test(id.split("?")[0] ?? id)
				)
					return null;
				const { program } = parse(id, code, { lang: "js" });
				read.modules.set(id, moduleLinks(program));
				return null;
			},
		},
		configureServer(server) {
			let ready: (compiled: Build | readonly Error[]) => void = () => {};
			first = new Promise((resolve) => {
				ready = resolve;
			});
			({
				module: devModuleOf,
				missingKeyImport,
				version: patchesMade,
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
			if (!building(this.environment)) return;
			if (facts !== undefined) {
				facts.keepAll();
				try {
					facts.save();
				} catch {
					// A cache that cannot be written only costs the next build its parse.
				}
			}
			seen = await seenThrough(
				read.modules,
				(id) => this.getModuleInfo(id),
				async (source, importer) =>
					(await this.resolve(source, importer)) ?? undefined,
			);
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
				// In dev, keys.js is the plugin's module, by an id of its own (`devKeysId`).
				if (module.type === "keys" && serving) {
					const resolved = await this.resolve(id, importer, {
						...options,
						skipSelf: true,
					});
					return resolved?.id === files.keysFile ? devKeysId : resolved;
				}
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
				if (key !== undefined) return `\0${keyPrefix}${key}`;
				return serving ? devKeysId : resolved;
			},
		},
		async load(id) {
			if (!serving && id === join(files.outdir, "testing.js")) {
				return this.error(
					"The output's testing.js binds a test's locale, so a build refuses it: import it from test files alone.",
				);
			}
			const served = devModuleOf(id);
			if (served !== undefined) return served;
			if (id !== devKeysId && id !== files.keysFile && !isMessageModule(id))
				return null;
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
	const reads = buildReads({
		build: () => build,
		outdir: () => files.outdir,
		reading: (environment) => readings.get(environment),
		read: (environment, id, reading) => {
			if (environment !== "client" || build === undefined) return;
			const { keys, every } = chunkReads(
				reading,
				build.compilation.keys.keys(),
			);
			if (keys.size > 0) read.reads.set(id, keys);
			if (every) read.computed.add(id);
		},
	});
	return {
		plugins: [reads, plugin],
		build: () => build,
		config: () => build?.config ?? readConfig(files.configFile),
		reading: (environment) => readings.get(environment),
	};
}
