import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeSources } from "./output-modules.ts";

/** This module's file, and grai's directory: `src` in grai's repository, `dist` as published. */
const self = fileURLToPath(import.meta.url);
const root = dirname(self);

/**
 * The file in grai's build that lists the compiler's modules (`compilerModules`), each by its path
 * in `dist` with the hash of its bytes as built (`digestOf`).
 */
export const compilerModulesFile = "compiler-modules.json";

const text = (url: URL): string => readFileSync(url, "utf8");

/**
 * The runtime's modules, which every output carries, their imports of each other pinned, and the
 * templates of the output's declarations; read once.
 */
let runtime: RuntimeSources | undefined;

export function runtimeSources(): RuntimeSources {
	runtime ??= {
		runtime: text(new URL("./runtime/runtime.js", import.meta.url)),
		server: text(new URL("./runtime/server.js", import.meta.url)),
		testing: text(new URL("./runtime/testing.js", import.meta.url)),
		declarations: {
			runtime: text(
				new URL("./runtime/runtime.d.ts.template", import.meta.url),
			),
			server: text(new URL("./runtime/server.d.ts.template", import.meta.url)),
			testing: text(
				new URL("./runtime/testing.d.ts.template", import.meta.url),
			),
			setLocale: {
				live: text(
					new URL("./runtime/set-locale.live.d.ts.template", import.meta.url),
				),
				reload: text(
					new URL("./runtime/set-locale.reload.d.ts.template", import.meta.url),
				),
			},
		},
	};
	return runtime;
}

/**
 * The compiler's identity (`compilerIdentity`): what decides the output besides the config and the
 * catalogs. A new version of grai changes it, and so does a local build, which keeps its version,
 * so the output is written again after either. Taken once.
 */
let compilerHash: string | undefined;

export function hashOfCompiler(): string {
	const sources = runtimeSources();
	compilerHash ??= compilerIdentity([
		sources.runtime,
		sources.server,
		sources.testing,
		sources.declarations.runtime,
		sources.declarations.server,
		sources.declarations.testing,
		sources.declarations.setLocale.live,
		sources.declarations.setLocale.reload,
	]);
	return compilerHash;
}

/**
 * The compiler's identity: a hash of its modules, each by its path in grai's directory and the
 * hash of its bytes as they are on disk, and of `copied`, the texts the output copies, which are
 * the runtime's modules and the templates of its declarations. A new version of grai changes it,
 * and so does a local change to any of them, which keeps the version.
 *
 * Its modules are those grai's build lists (`compilerModulesFile`), while each is as built: they are
 * the modules a compile runs and its saved build is read by, as the build found them by parsing
 * them, and with the same bytes they import the same. Otherwise, as in a patched install or in
 * grai's own source, every module of grai's directory, as no list of them is then sure. Hashing the
 * listed modules costs a start about 1 ms, against about 7 ms for every module.
 */
function compilerIdentity(copied: readonly string[]): string {
	const modules = builtModules() ?? digests(everyModule());
	const digest = createHash("sha1");
	const ordered = [...modules].sort(([a], [b]) => (a < b ? -1 : 1));
	for (const [file, hash] of ordered)
		digest.update(file).update("\0").update(hash).update("\0");
	for (const text of copied) digest.update(text).update("\0");
	return digest.digest("hex");
}

/** The hash of a module's bytes. */
export function digestOf(bytes: Buffer): string {
	return createHash("sha1").update(bytes).digest("hex");
}

function digests(modules: ReadonlyMap<string, Buffer>): Map<string, string> {
	return new Map([...modules].map(([file, bytes]) => [file, digestOf(bytes)]));
}

/**
 * The compiler's modules as grai's build lists them, each with the hash of its bytes, if the build
 * lists them, the list holds this module, and each is as built.
 */
function builtModules(): Map<string, string> | undefined {
	let listed: unknown;
	try {
		listed = JSON.parse(readFileSync(join(root, compilerModulesFile), "utf8"));
	} catch {
		return undefined;
	}
	if (typeof listed !== "object" || listed === null) return undefined;
	const modules = new Map<string, string>();
	for (const [path, built] of Object.entries(listed)) {
		const file = join(root, path);
		if (!within(root, file) || relative(root, file) !== path) return undefined;
		let bytes: Buffer;
		try {
			bytes = readFileSync(file);
		} catch {
			return undefined;
		}
		const digest = digestOf(bytes);
		if (digest !== built) return undefined;
		modules.set(path, digest);
	}
	return modules.has(relative(root, self)) ? modules : undefined;
}

/**
 * Every module of grai's directory, by its path in it, and the templates of its declarations,
 * when the compiler's own are not those its build lists.
 */
function everyModule(): Map<string, Buffer> {
	const files = readdirSync(root, { recursive: true, encoding: "utf8" }).filter(
		(file) =>
			(/\.(js|ts)$/.test(file) && !file.endsWith(".d.ts")) ||
			file.endsWith(".d.ts.template"),
	);
	return new Map(files.map((file) => [file, readFileSync(join(root, file))]));
}

/** Whether a file is in a directory, at any depth. */
export function within(directory: string, file: string): boolean {
	const path = relative(directory, file);
	return (
		path !== "" &&
		path !== ".." &&
		!path.startsWith(`..${sep}`) &&
		!isAbsolute(path)
	);
}
