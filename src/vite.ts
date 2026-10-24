import { join, resolve } from "node:path";
import type { Plugin } from "vite";
import { type Build, recompile } from "./compile.ts";
import { readConfig } from "./config.ts";
import { devModule } from "./dev-module.ts";
import { type GraiError, messagesOf } from "./error.ts";
import { keyModulePrefix, keyPrefix } from "./locale-chunks.ts";
import {
	chunkFileName,
	keyModule,
	keysModule,
	messageChunkCopies,
	messageChunking,
} from "./vite-build.ts";
import {
	followedFile,
	type ProjectFiles,
	patchPrefix,
	serveMessages,
} from "./vite-dev.ts";

/** The plugin's options. `config` is the path of the project's grai.config.json, from Vite's root. */
export type GraiOptions = { config?: string };

/**
 * grai's Vite plugin. In dev it compiles the catalogs when the server starts and whenever one
 * of them or the config changes, and nothing else; it serves every message as one module from
 * memory, and an edit sends only the changed keys' functions, which the page writes in place
 * (`vite-dev.ts`, `dev-module.ts`). In a build, every key is a module of its own, so each chunk
 * holds only the keys its code uses; in the client build those modules go to chunks of their
 * own, under `grai/`, and each locale gets a copy of each under `grai-<locale>/`, with the same
 * names and only its own words (`vite-build.ts`, `locale-chunks.ts`).
 */
export function grai(options: GraiOptions = {}): Plugin {
	let files: ProjectFiles = { configFile: "", outdir: "", keysFile: "" };
	let serving = false;
	let build: Build | undefined;
	/** The first compile: its build, or the errors that kept it from one. */
	let first: Promise<Build | readonly GraiError[]> | undefined;
	let patchOf: (id: string) => string | undefined = () => undefined;
	let closeMessages = async () => {};
	const copies = messageChunkCopies();
	const building = (environment: { name: string } | undefined) =>
		!serving && environment?.name === "client";

	return {
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
			let ready: (compiled: Build | readonly GraiError[]) => void = () => {};
			first = new Promise((resolve) => {
				ready = resolve;
			});
			({ patch: patchOf, close: closeMessages } = serveMessages(
				server,
				files,
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
		resolveId(id) {
			return id.startsWith(keyPrefix) || id.startsWith(patchPrefix)
				? `\0${id}`
				: null;
		},
		async load(id) {
			const patch = patchOf(id);
			if (patch !== undefined) return patch;
			if (id !== files.keysFile && !id.startsWith(keyModulePrefix)) return null;
			const compiled = build ?? (await first);
			if (compiled === undefined) return null;
			if (!("compilation" in compiled)) return this.error(messagesOf(compiled));
			// Without side effects, a build leaves out every key a chunk's code does not use, so a key
			// lands in the chunks of the entries that use it.
			const code =
				id !== files.keysFile
					? keyModule(files.outdir, compiled, id)
					: serving
						? devModule(files.outdir, compiled)
						: keysModule(compiled);
			return code === undefined ? null : { code, moduleSideEffects: false };
		},
		hotUpdate({ file }) {
			// The plugin follows the catalogs and the config itself, and its output is its own.
			return followedFile(files, build, file) ? [] : undefined;
		},
	};
}
