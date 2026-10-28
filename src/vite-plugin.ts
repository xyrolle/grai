import { basename, join, relative, resolve } from "node:path";
import type { Plugin, ResolvedConfig } from "vite";
import { baseDisagreement, type FrameworkBase } from "./base-agreement.ts";
import type { BuildReading } from "./code/build-reading.ts";
import { type Build, type CompiledProject, recompile } from "./compile.ts";
import { type Config, readConfig } from "./config.ts";
import { devModule, pageKeysShell } from "./dev-module.ts";
import { GraiError, messagesOf } from "./error.ts";
import {
	isMessageModule,
	keyModulePrefix,
	keyPrefix,
	outputPrefix,
	textPrefix,
} from "./locale-chunks.ts";
import { moduleOf } from "./output-paths.ts";
import {
	everyLocale,
	isDevKeys,
	pageKeysId,
	pageKeysLocale,
} from "./page-keys.ts";
import { realPath } from "./real-path.ts";
import type { Bundling } from "./vite-bundling.ts";
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
import { buildReads } from "./vite-reads.ts";
import { unwrittenOutput } from "./vite-unwritten.ts";

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
 * grai's Vite plugins: the one that reads each module before any other, the one that does the rest,
 * and in dev the one that resolves the output's files before they are written. With them, for the
 * adapters built on them, the build a build's compile made: a dev server serves its builds itself.
 */
export type GraiPlugin = {
	plugins: Plugin[];
	build: () => Build | undefined;
	/** The project's config: as the last compile read it, or as its file has it before any compile. */
	config: () => Config;
	/** A build environment's reading of its modules, which the adapters' transforms share. */
	reading: (environment: string) => BuildReading | undefined;
};

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

/**
 * Whether a Vite config is Vitest's, in any mode a run gives it, its browser mode's included: Vitest
 * adds plugins of its own to every server it makes, named `vitest:…`.
 */
const isVitest = (config: ResolvedConfig): boolean =>
	config.plugins.some(({ name }) => name.startsWith("vitest:"));

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
	/**
	 * Whether Vite runs tests, where a module is what a test can mock: in mode `test`, or as Vitest's
	 * server in whatever mode it runs (`isVitest`).
	 */
	let testing = false;
	/** A build's compile: its build, or the errors that kept it from one, which every environment's build awaits. */
	let first: Promise<Build | readonly Error[]> | undefined;
	let build: Build | undefined;
	/** The dev server's first compile: its build, or the errors that kept it from one. */
	let firstServed: Promise<CompiledProject | readonly Error[]> | undefined;
	/** The build the dev server serves, its last compile's. */
	let served: CompiledProject | undefined;
	let devModuleOf: (id: string) => string | undefined = () => undefined;
	let missingKeyImport = (
		_key: string,
		_importer: string,
	): string | undefined => undefined;
	/** How many patches the dev server has made: the version of the dev module it serves now. */
	let patchesMade = () => 0;
	let closeMessages = async () => {};
	/** Has the dev server write its first compile's output now, if it has not yet (`serveMessages`). */
	let writeServed = async () => false;
	/** The plugin's part in a build, which a dev server never runs: loaded as a build's config is. */
	let bundling: Bundling | undefined;
	/**
	 * keys.js, a page's in one locale, or a key's module, as the dev server serves them from memory;
	 * nothing for any other id. keys.js holds every locale for a server; for the client it takes
	 * the module of the page's locale, or in a worker of every locale (`pageKeysShell`). A test
	 * holds every locale through any of them, as `useLocale` switches between them.
	 */
	const devCode = (id: string, compiled: CompiledProject, client: boolean) => {
		if (id === devKeysId || id === files.keysFile)
			return client && !testing
				? pageKeysShell(compiled)
				: devModule(files.outdir, compiled, patchesMade());
		if (id === pageKeysId(everyLocale))
			return devModule(files.outdir, compiled, patchesMade());
		const locale = pageKeysLocale(id, compiled.config.locales);
		if (locale !== undefined)
			return devModule(
				files.outdir,
				compiled,
				patchesMade(),
				testing ? undefined : locale,
			);
		return id.startsWith(keyModulePrefix)
			? keyFromKeys(files, id.slice(keyModulePrefix.length))
			: undefined;
	};
	/**
	 * A file of the output as the dev server serves it, from the build in memory, which the server
	 * may serve before the output is written: a page then never takes a file of another compile
	 * that the outdir still holds.
	 */
	const outputCode = (id: string, compiled: CompiledProject) =>
		compiled.rendered.files.get(relative(files.outdir, id));

	const plugin: Plugin = {
		name: "grai",
		async config(config, environment) {
			// Real paths, as the bundler names modules: a project reached through a symlink would
			// otherwise match none of its own module ids.
			const configFile = realPath(
				resolve(config.root ?? "", options.config ?? "grai.config.json"),
			);
			const outdir = realPath(readConfig(configFile).outdir);
			files = { configFile, outdir, keysFile: join(outdir, "keys.js") };
			serving = environment.command === "serve";
			testing = environment.mode === "test";
			if (serving) return;
			const { bundling: bundlingOf } = await import("./vite-bundling.ts");
			bundling = bundlingOf({
				files,
				localeChunks: options.localeChunks === true,
				pageEntries: adapter.pageEntries,
				build: () => build,
			});
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
			testing ||= isVitest(resolved);
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
			return bundling?.outputOptions(this, output) ?? null;
		},
		renderChunk(code, chunk) {
			bundling?.renderChunk(this, code, chunk);
			return null;
		},
		generateBundle(_, bundle) {
			bundling?.generateBundle(this, bundle);
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
			bundling?.start(this, compiled);
		},
		transform: {
			order: "post",
			filter: { id: { exclude: [/\/node_modules\//, /^\0/] } },
			handler(code, id) {
				bundling?.shipped(this, code, id);
				return null;
			},
		},
		configureServer(server) {
			let ready: (compiled: CompiledProject | readonly Error[]) => void =
				() => {};
			firstServed = new Promise((resolve) => {
				ready = resolve;
			});
			({
				module: devModuleOf,
				missingKeyImport,
				version: patchesMade,
				write: writeServed,
				close: closeMessages,
			} = serveMessages(
				server,
				files,
				// A test run reads the output only once it is written, as it does whatever else it imports.
				{ reloadOnEdit: options.reloadOnEdit === true, servesFirst: !testing },
				(compiled) => {
					if ("compilation" in compiled) served = compiled;
					ready(compiled);
				},
			));
		},
		// The dev server calls it as it closes: the compile under way finishes first, so nothing is
		// written into the project once the server has closed.
		async buildEnd() {
			await closeMessages();
			await bundling?.end(this);
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
				const compiled = serving ? (served ?? (await firstServed)) : build;
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
				// keys.js, or the dev module for it, as the output's resolver has it before the output is
				// written (`unwrittenOutput`).
				if (resolved?.id !== files.keysFile && resolved?.id !== devKeysId)
					return resolved;
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
			if (serving) {
				const patch = devModuleOf(id);
				if (patch !== undefined) return patch;
				const devModuleId =
					isDevKeys(id) || id === files.keysFile || isMessageModule(id);
				const output = !devModuleId && id.startsWith(`${files.outdir}/`);
				if (!devModuleId && !output) return null;
				const compiled = served ?? (await firstServed);
				if (compiled === undefined) return null;
				// Until a compile succeeds, the output's files are the outdir's, as no build was served.
				if (!("compilation" in compiled))
					return output ? null : this.error(messagesOf(compiled));
				// No source map: the module is the compiler's, or a file of its output, with no source of its
				// own to map back to, and Vite would inline a map of every line it rewrites, several times
				// the module's size.
				if (output) {
					const code = outputCode(id, compiled);
					return code === undefined ? null : { code, map: { mappings: "" } };
				}
				const code = devCode(
					id,
					compiled,
					this.environment.config.consumer === "client",
				);
				return code === undefined
					? null
					: { code, moduleSideEffects: false, map: { mappings: "" } };
			}
			if (id === join(files.outdir, "testing.js")) {
				return this.error(
					"The output's testing.js binds a test's locale, so a build refuses it: import it from test files alone.",
				);
			}
			if (id !== files.keysFile && !isMessageModule(id)) return null;
			const compiled = build ?? (await first);
			if (compiled === undefined) return null;
			if (!("compilation" in compiled)) return this.error(messagesOf(compiled));
			const code = bundling?.moduleCode(
				id,
				compiled,
				this.environment.config.consumer,
			);
			// Without side effects, a build leaves out every key a chunk's code does not use, so a key
			// lands in the chunks of the entries that use it. A build keeps its maps, which tools read
			// to tell what each chunk holds.
			return code === undefined ? null : { code, moduleSideEffects: false };
		},
		hotUpdate({ file }) {
			// The plugin follows the catalogs and the config itself, and its output is its own.
			return followedFile(files, served ?? build, file) ? [] : undefined;
		},
	};
	const reads = buildReads({
		build: () => build,
		outdir: () => files.outdir,
		reading: (environment) => bundling?.reading(environment),
		read: (environment, id, reading) =>
			bundling?.took(environment, id, reading),
	});
	const unwritten = unwrittenOutput({
		files: () => files,
		served: () => served,
		write: () => writeServed(),
	});
	return {
		plugins: [reads, plugin, unwritten],
		build: () => build,
		config: () => (served ?? build)?.config ?? readConfig(files.configFile),
		reading: (environment) => bundling?.reading(environment),
	};
}
