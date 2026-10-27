import { join } from "node:path";
import type { Rolldown } from "vite";
import { BuildReading } from "./code/build-reading.ts";
import { FactsCache } from "./code/facts-cache.ts";
import { parse } from "./code/parse.ts";
import type { Reading } from "./code/reads.ts";
import { withGroups } from "./code-splitting.ts";
import type { Build } from "./compile.ts";
import { messagesOf } from "./error.ts";
import { keyModulePrefix, textModulePrefix } from "./locale-chunks.ts";
import { type ModuleLinks, moduleLinks, seenThrough } from "./module-links.ts";
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
import type { ProjectFiles } from "./vite-dev.ts";
import { chunkReads } from "./vite-reads.ts";

/** What a build takes from grai's plugin, which loads this module as a build starts. */
export type BundlingOf = {
	files: ProjectFiles;
	/** Whether the client build writes each message chunk's copies, one per locale. */
	localeChunks: boolean;
	/** The entries each page's first paint loads together, from the framework's adapter. */
	pageEntries: (() => Iterable<readonly string[]>) | undefined;
	/** The build the plugin's compile made. */
	build: () => Build | undefined;
};

/**
 * The plugin's part in a build, which a dev server never runs, each member called from the plugin's
 * hook of its name or its kind.
 */
export type Bundling = {
	/** A build environment's reading of its modules, which the adapters' transforms share. */
	reading: (environment: string) => BuildReading | undefined;
	/** A build environment's start, once the compile has made `compiled`. */
	start: (context: Rolldown.PluginContext, compiled: Build) => void;
	/** What a module reads of the keys before any transform, for the client build's chunking. */
	took: (environment: string, id: string, reading: Reading) => void;
	/**
	 * A module's code as the client build ships it, a component's compiled, which tells its chunking
	 * what the module links to, globs expanded.
	 */
	shipped: (context: Rolldown.PluginContext, code: string, id: string) => void;
	/**
	 * An output with grai's groups, which join each output as Vite resolved it, and none for an
	 * output that splits no code (`code-splitting.ts`).
	 */
	outputOptions: (
		context: Rolldown.MinimalPluginContext,
		output: Rolldown.OutputOptions,
	) => Rolldown.OutputOptions | null;
	renderChunk: (
		context: Rolldown.PluginContext,
		code: string,
		chunk: Rolldown.RenderedChunk,
	) => void;
	generateBundle: (
		context: Rolldown.PluginContext,
		bundle: Rolldown.OutputBundle,
	) => void;
	end: (context: Rolldown.PluginContext) => Promise<void>;
	/**
	 * keys.js, a key's module or a text key's string module, from the compiler's model, for the
	 * browser or a server; nothing for any other id.
	 */
	moduleCode: (
		id: string,
		compiled: Build,
		consumer: "client" | "server",
	) => string | undefined;
};

/** The modules whose shipped code links the client build's modules: scripts, and components. */
const scanned = /\.(?:[cm]?[jt]sx?|svelte|vue|astro|mdx)$/;

const isClient = (context: Rolldown.MinimalPluginContext) =>
	context.environment.name === "client";

/**
 * The plugin's part in a build: each build environment's reading of its modules, the client build's
 * chunking of the keys by the pages that load them, the copies of its message chunks per locale,
 * and the modules of keys.js, each key and each text key.
 */
export function bundling({
	files,
	localeChunks,
	pageEntries,
	build,
}: BundlingOf): Bundling {
	/** Each build environment's reading of its modules, from its start. */
	const readings = new Map<string, BuildReading>();
	// The facts of the modules the build reads, kept with the CLI's by their code's hash.
	const facts = new FactsCache(join(files.outdir, stateDirectory));
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
		const compiled = build();
		if (compiled === undefined) return undefined;
		pageChunks ??= keyPageChunks(
			compiled,
			files.keysFile,
			(module) => graph.getModuleInfo(module),
			{ reads: read.reads, computed: read.computed, imports: seen },
			pageEntries === undefined ? undefined : [...pageEntries()],
		);
		return pageChunks.get(id);
	};
	/** Whether this build writes each message chunk's copies, one per locale. */
	const copying = (context: Rolldown.MinimalPluginContext) =>
		localeChunks && isClient(context);

	return {
		reading: (environment) => readings.get(environment),
		start(context, compiled) {
			pageChunks = undefined;
			if (isClient(context)) {
				read.reads.clear();
				read.computed.clear();
				read.modules.clear();
				seen = new Map();
			}
			const held = placeholderTexts(compiled);
			if (held.length > 0) context.error(messagesOf(held));
			readings.set(
				context.environment.name,
				new BuildReading(
					compiled.config.root,
					files.outdir,
					// Through grai's own resolveId too, which gives a key's path its key's module.
					(source, importer) =>
						context.resolve(source, importer, { skipSelf: false }).then(
							(resolved) => resolved?.id,
							// A build that ends first drops its resolver: what it can no longer follow is
							// none of grai's, as the bundler reports what it cannot resolve itself.
							() => undefined,
						),
					facts,
				),
			);
		},
		took(environment, id, reading) {
			const compiled = build();
			if (environment !== "client" || compiled === undefined) return;
			const { keys, every } = chunkReads(
				reading,
				compiled.compilation.keys.keys(),
			);
			if (keys.size > 0) read.reads.set(id, keys);
			if (every) read.computed.add(id);
		},
		shipped(context, code, id) {
			if (!isClient(context) || build() === undefined) return;
			if (id.startsWith(files.outdir) || !scanned.test(id.split("?")[0] ?? id))
				return;
			const { program } = parse(id, code, { lang: "js" });
			read.modules.set(id, moduleLinks(program));
		},
		outputOptions(context, output) {
			if (output.codeSplitting === false) return null;
			if (context.environment.config.consumer === "server")
				return {
					...output,
					codeSplitting: withGroups(output.codeSplitting, [sharedKeys]),
				};
			if (!isClient(context)) return null;
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
		renderChunk(context, code, chunk) {
			if (!copying(context)) return;
			copies.render(
				chunk.fileName,
				chunk.moduleIds,
				code,
				build()?.config.locales ?? [],
			);
		},
		generateBundle(context, bundle) {
			if (!copying(context)) return;
			const chunks = Object.values(bundle).filter(
				(file) => file.type === "chunk",
			);
			copies.emit(
				chunks,
				context.environment.config.build.minify !== false,
				(fileName, source) =>
					context.emitFile({ type: "asset", fileName, source }),
			);
		},
		async end(context) {
			if (!isClient(context)) return;
			facts.keepAll();
			try {
				facts.save();
			} catch {
				// A cache that cannot be written only costs the next build its parse.
			}
			seen = await seenThrough(
				read.modules,
				(id) => context.getModuleInfo(id),
				async (source, importer) =>
					(await context.resolve(source, importer)) ?? undefined,
			);
		},
		moduleCode(id, compiled, consumer) {
			if (id.startsWith(textModulePrefix))
				return textModule(compiled, id, consumer);
			if (id === files.keysFile) return keysModule(compiled);
			return id.startsWith(keyModulePrefix)
				? keyModule(compiled, id, consumer)
				: undefined;
		},
	};
}
