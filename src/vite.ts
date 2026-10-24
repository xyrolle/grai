import { join, resolve } from "node:path";
import { type DevEnvironment, minifySync, type Plugin } from "vite";
import type { CompiledKey } from "./compilation.ts";
import { type Build, recompile } from "./compile.ts";
import { readConfig } from "./config.ts";
import type { GraiError } from "./error.ts";
import {
	besideDirectory,
	keyModulePrefix,
	keyPrefix,
	localeCopies,
	localeDirectory,
	messageDirectory,
	messageOnly,
} from "./locale-chunks.ts";
import { pluralName } from "./plurals.ts";
import { watch } from "./watch.ts";

/** The plugin's options. `config` is the path of the project's grai.config.json, from Vite's root. */
export type GraiOptions = { config?: string };

const patchPrefix = "grai:patch/";

/**
 * grai's Vite plugin. In dev it compiles the catalogs when the server starts and whenever one
 * of them or the config changes, and nothing else; it serves every message as one module from
 * memory, and an edit sends only the changed keys' functions, which the page writes in place.
 * In a build, every key is a module of its own, so each chunk holds only the keys its code uses.
 * In the client build those modules go to chunks of their own, under `grai/`, and each locale
 * gets a copy of each under `grai-<locale>/`, with the same names and only its own words.
 */
export function grai(options: GraiOptions = {}): Plugin {
	let configFile = "";
	let keysFile = "";
	let outdir = "";
	let serving = false;
	/** Each message-only chunk's code per locale, by the chunk's file name before hashing. */
	const copies = new Map<string, Map<string, string>>();
	let build: Build | undefined;
	/** The first compile, or the errors that kept it from a build. */
	let first: Promise<Build | readonly GraiError[]> | undefined;
	const patches = new Map<string, string>();

	const runtimeImports = (
		keys: Iterable<CompiledKey>,
		functions: Iterable<string>,
	) => {
		const uses = new Set(functions);
		const plurals = new Set<string>();
		for (const key of keys) {
			for (const name of key.uses) if (name === "unmatched") uses.add(name);
			for (const locale of key.plurals) plurals.add(pluralName(locale));
		}
		const lines = [
			`import { ${[...uses].sort().join(", ")} } from ${JSON.stringify(join(outdir, "runtime.js"))};`,
		];
		if (plurals.size > 0)
			lines.push(
				`import { ${[...plurals].sort().join(", ")} } from ${JSON.stringify(join(outdir, "plurals.js"))};`,
			);
		return lines.join("\n");
	};

	return {
		name: "grai",
		config(config, environment) {
			configFile = resolve(
				config.root ?? "",
				options.config ?? "grai.config.json",
			);
			outdir = readConfig(configFile).outdir;
			keysFile = join(outdir, "keys.js");
			serving = environment.command === "serve";
		},
		configEnvironment(name) {
			if (serving || name !== "client") return;
			const runtime = new Set(
				["runtime.js", "config.js", "plurals.js"].map((file) =>
					join(outdir, file),
				),
			);
			// The runtime in a chunk of its own, and the keys in chunks by the entries that use them,
			// so a message chunk holds keys and nothing else.
			const groups = [
				{ name: "grai-runtime", test: (id: string) => runtime.has(id) },
				{
					name: messageDirectory,
					test: (id: string) => id.startsWith(keyModulePrefix),
					entriesAware: true,
				},
			];
			return {
				build: { rolldownOptions: { output: { codeSplitting: { groups } } } },
			};
		},
		outputOptions(output) {
			if (serving || this.environment?.name !== "client") return null;
			const named = output.chunkFileNames;
			return {
				...output,
				chunkFileNames: (chunk) => {
					const fileName =
						typeof named === "function"
							? named(chunk)
							: (named ?? "[name]-[hash].js");
					return messageOnly(chunk.moduleIds)
						? besideDirectory(fileName, messageDirectory)
						: fileName;
				},
			};
		},
		renderChunk(code, chunk) {
			if (
				serving ||
				this.environment.name !== "client" ||
				!messageOnly(chunk.moduleIds)
			)
				return null;
			copies.set(
				chunk.fileName,
				localeCopies(chunk.fileName, code, build?.config.locales ?? []),
			);
			return null;
		},
		generateBundle(_, bundle) {
			if (serving || this.environment.name !== "client") return;
			// A chunk's file name has a placeholder for its hash until the bundle is written.
			const hashes = new Map<string, string>();
			const chunks = Object.values(bundle).filter(
				(file) => file.type === "chunk",
			);
			for (const chunk of chunks) {
				const token = chunk.preliminaryFileName.match(/!~\{\d+\}~/)?.[0];
				if (token === undefined) continue;
				const at = chunk.preliminaryFileName.indexOf(token);
				const after = chunk.preliminaryFileName.length - at - token.length;
				hashes.set(
					token,
					chunk.fileName.slice(at, chunk.fileName.length - after),
				);
			}
			const minify = this.environment.config.build.minify !== false;
			for (const chunk of chunks) {
				for (const [locale, code] of copies.get(chunk.preliminaryFileName) ??
					[]) {
					const linked = code.replaceAll(
						/!~\{\d+\}~/g,
						(token) => hashes.get(token) ?? token,
					);
					this.emitFile({
						type: "asset",
						fileName: besideDirectory(chunk.fileName, localeDirectory(locale)),
						source: minify ? minifySync(chunk.fileName, linked).code : linked,
					});
				}
			}
		},
		async buildStart() {
			if (serving) return;
			first ??= recompile(configFile, undefined).then(
				({ result, build: next }) => {
					build = next;
					return next ?? result.errors;
				},
			);
			const compiled = await first;
			if (!("compilation" in compiled)) this.error(describe(compiled));
		},
		configureServer(server) {
			const client = server.environments.client;
			let ready: (compiled: Build | readonly GraiError[]) => void = () => {};
			first = new Promise((resolve) => {
				ready = resolve;
			});
			const watcher = watch(configFile, (result, _milliseconds, next) => {
				if (next === undefined) {
					ready(result.errors);
					client.hot.send({
						type: "error",
						err: {
							message: describe(result.errors),
							stack: "",
							plugin: "grai",
						},
					});
					return;
				}
				const previous = build;
				build = next;
				ready(next);
				if (previous !== undefined) void update(previous, next);
			});
			server.httpServer?.once("close", watcher.close);

			const update = async (previous: Build, next: Build) => {
				const changed = [...next.compilation.changed];
				if (changed.length === 0) return;
				const others = Object.values(server.environments).filter(
					(environment) => environment !== client,
				);
				for (const environment of others) await reload(environment, keysFile);
				const sameExports = changed.every(
					(key) =>
						previous.compilation.keys.has(key) &&
						next.compilation.keys.has(key),
				);
				const sameLocales =
					JSON.stringify(previous.config.locales) ===
					JSON.stringify(next.config.locales);
				if (!sameExports || !sameLocales) {
					await reload(client, keysFile);
					client.hot.send({ type: "full-reload" });
					return;
				}
				const module = client.moduleGraph.getModuleById(keysFile);
				if (module !== undefined) client.moduleGraph.invalidateModule(module);
				const id = `${patchPrefix}${patches.size}`;
				const keys = changed.flatMap(
					(key) => next.compilation.keys.get(key) ?? [],
				);
				patches.set(
					`\0${id}`,
					`${runtimeImports(keys, [])}\nexport const rows = {\n${changed.map((key) => `\t${key}: ${row(next.compilation.keys.get(key))},`).join("\n")}\n};\n`,
				);
				client.hot.send({
					type: "custom",
					event: "grai:update",
					data: { url: `/@id/__x00__${id}` },
				});
			};
		},
		resolveId(id) {
			return id.startsWith(keyPrefix) || id.startsWith(patchPrefix)
				? `\0${id}`
				: null;
		},
		async load(id) {
			const patch = patches.get(id);
			if (patch !== undefined) return patch;
			if (id !== keysFile && !id.startsWith(keyModulePrefix)) return null;
			const compiled = build ?? (await first);
			if (compiled === undefined) return null;
			if (!("compilation" in compiled)) return this.error(describe(compiled));
			const current = compiled;
			// Without side effects, a build leaves out every key a chunk's code does not use, so a key
			// lands in the chunks of the entries that use it.
			if (id === keysFile)
				return {
					code: serving ? devModule(current) : keysModule(current),
					moduleSideEffects: false,
				};
			const key = id.slice(keyModulePrefix.length);
			const module = current.compilation.keys.get(key);
			if (module === undefined) return null;
			return {
				code: `${runtimeImports([module], module.uses)}\n${module.code}`,
				moduleSideEffects: false,
			};
		},
		hotUpdate({ file }) {
			// The plugin follows the catalogs and the config itself, and its output is its own.
			const catalogs = [...(build?.config.catalogs.values() ?? [])];
			if (
				file === configFile ||
				file.startsWith(`${outdir}/`) ||
				catalogs.includes(file)
			)
				return [];
			return undefined;
		},
	};

	/** keys.js in dev: every key, its locales in a table an edit writes into, and the update's handler. */
	function devModule(current: Build): string {
		const keys = [...current.compilation.keys];
		const exports = keys.map(([key, compiled]) =>
			compiled.kind === "markup"
				? `export const ${key} = markup(live(${JSON.stringify(key)}, "v"), live(${JSON.stringify(key)}, "p"));`
				: `export const ${key} = message(...live(${JSON.stringify(key)}, "v"));`,
		);
		return `${runtimeImports(current.compilation.keys.values(), ["markup", "message"])}
const T = {
${keys.map(([key, compiled]) => `\t${key}: ${row(compiled)},`).join("\n")}
};
const live = (key, field) => T[key][field].map((_, n) => (inputs) => {
	const variant = T[key][field][n];
	return typeof variant === "function" ? variant(inputs) : variant;
});
${exports.join("\n")}
if (import.meta.hot) {
	import.meta.hot.on("grai:update", async ({ url }) => {
		const { rows } = await import(/* @vite-ignore */ url);
		for (const [key, row] of Object.entries(rows)) Object.assign(T[key], row);
		// A framework adapter that renders again on its own cancels the event; else the page reloads.
		if (typeof window !== "undefined" && window.dispatchEvent(new CustomEvent("grai:change", { cancelable: true }))) location.reload();
	});
}
`;
	}
}

/** A key's row in the dev table: its locales' variants, and their parts for markup. */
function row(compiled: CompiledKey | undefined): string {
	if (compiled === undefined) return "{}";
	const parts =
		compiled.kind === "markup" ? `, p: [${compiled.parts.join(", ")}]` : "";
	return `{ v: [${compiled.variants.join(", ")}]${parts} }`;
}

/** keys.js in a build: each key from its own module, so a chunk holds only the keys its code uses. */
function keysModule(current: Build): string {
	return [...current.compilation.keys.keys()]
		.map((key) => `export { ${key} } from "${keyPrefix}${key}";`)
		.join("\n");
}

/** Has an environment take a module again, if it holds it. */
async function reload(environment: DevEnvironment, id: string): Promise<void> {
	const module = environment.moduleGraph.getModuleById(id);
	if (module !== undefined) await environment.reloadModule(module);
}

function describe(errors: readonly GraiError[]): string {
	return errors.map((error) => error.message).join("\n");
}
