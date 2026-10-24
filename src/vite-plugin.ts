import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { type Build, recompile } from "./compile.ts";
import { readConfig } from "./config.ts";
import { devModule } from "./dev-module.ts";
import { messagesOf } from "./error.ts";
import {
	isMessageModule,
	keyPrefix,
	textModulePrefix,
	textPrefix,
} from "./locale-chunks.ts";
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
	type ProjectFiles,
	patchPrefix,
	serveMessages,
} from "./vite-dev.ts";

/**
 * The plugin's options:
 * - `config`: the path of the project's grai.config.json, from Vite's root.
 * - `reloadOnEdit`: in dev, reload the open pages after an edit rather than patch them in place,
 *   having sent the servers their patch first. For a framework whose pages the server draws and
 *   no client code could draw again, such as Astro's.
 */
export type GraiOptions = { config?: string; reloadOnEdit?: boolean };

/** grai's Vite plugin, and the build its last compile made, for the adapters built on it. */
export type GraiPlugin = { plugin: Plugin; build: () => Build | undefined };

/** grai's Vite plugin (`vite.ts` says what it does), with its build. */
export function graiPlugin(options: GraiOptions): GraiPlugin {
	let files: ProjectFiles = { configFile: "", outdir: "", keysFile: "" };
	let serving = false;
	let build: Build | undefined;
	/** The first compile: its build, or the errors that kept it from one. */
	let first: Promise<Build | readonly Error[]> | undefined;
	let patchOf: (id: string) => string | undefined = () => undefined;
	let closeMessages = async () => {};
	const copies = messageChunkCopies();
	const building = (environment: { name: string } | undefined) =>
		!serving && environment?.name === "client";
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
			return textModule(files.outdir, compiled, id);
		if (id !== files.keysFile)
			return keyModule(files.outdir, compiled, id, consumer);
		return serving ? devModule(files.outdir, compiled) : keysModule(compiled);
	};

	const plugin: Plugin = {
		name: "grai",
		config(config, environment) {
			const configFile = resolve(
				config.root ?? "",
				options.config ?? "grai.config.json",
			);
			const { outdir } = readConfig(configFile);
			files = { configFile, outdir, keysFile: join(outdir, "keys.js") };
			serving = environment.command === "serve";
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
			if (building(this.environment)) {
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
			if (!building(this.environment)) return;
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
			first ??= recompile(files.configFile, undefined).then(
				({ result, build: next }) => {
					build = next;
					return next ?? result.errors;
				},
			);
			const compiled = await first;
			if (!("compilation" in compiled)) this.error(messagesOf(compiled));
		},
		configureServer(server) {
			let ready: (compiled: Build | readonly Error[]) => void = () => {};
			first = new Promise((resolve) => {
				ready = resolve;
			});
			({ patch: patchOf, close: closeMessages } = serveMessages(
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
			async handler(id) {
				if (
					id.startsWith(keyPrefix) ||
					id.startsWith(textPrefix) ||
					id.startsWith(patchPrefix)
				)
					return `\0${id}`;
				if (serving) await first;
				return null;
			},
		},
		async load(id) {
			const patch = patchOf(id);
			if (patch !== undefined) return patch;
			if (id !== files.keysFile && !isMessageModule(id)) return null;
			const compiled = build ?? (await first);
			if (compiled === undefined) return null;
			if (!("compilation" in compiled)) return this.error(messagesOf(compiled));
			// Without side effects, a build leaves out every key a chunk's code does not use, so a key
			// lands in the chunks of the entries that use it.
			const code = moduleCode(id, compiled, this.environment.config.consumer);
			return code === undefined ? null : { code, moduleSideEffects: false };
		},
		hotUpdate({ file }) {
			// The plugin follows the catalogs and the config itself, and its output is its own.
			return followedFile(files, build, file) ? [] : undefined;
		},
	};
	return { plugin, build: () => build };
}
