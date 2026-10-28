import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeSources } from "./output-modules.ts";
import {
	packageDirectory,
	packageFile,
	packageFilesModule,
} from "./package-files.ts";

/** grai's directory: `src` in grai's repository, `dist` as published. */
const root = fileURLToPath(packageDirectory);

/**
 * The file in grai's build that lists the chunks of its bundle a part of grai runs, each by its
 * path in `dist` with the hash of its bytes as built (`digestOf`): the compiler's, which a compile
 * runs and its saved build is read by, and the code reader's, which reads an app's files for their
 * facts. Each list holds the chunks of that part's modules and every chunk they import in turn, as
 * the bundler made them.
 */
export const builtModulesFile = "built-modules.json";

/** A part of grai whose chunks its build lists (`builtModulesFile`). */
export type BuiltPart = "compiler" | "reader";

const text = (path: string): string => readFileSync(packageFile(path), "utf8");

/**
 * The runtime's modules, which every output carries, their imports of each other pinned, and the
 * templates of the output's declarations; read once.
 */
let runtime: RuntimeSources | undefined;

export function runtimeSources(): RuntimeSources {
	runtime ??= {
		runtime: text("runtime/runtime.js"),
		server: text("runtime/server.js"),
		testing: text("runtime/testing.js"),
		declarations: {
			runtime: text("runtime/runtime.d.ts.template"),
			server: text("runtime/server.d.ts.template"),
			testing: text("runtime/testing.d.ts.template"),
			setLocale: {
				live: text("runtime/set-locale.live.d.ts.template"),
				reload: text("runtime/set-locale.reload.d.ts.template"),
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
 * The compiler's identity: a hash of its modules (`partModules`), each by its path in grai's
 * directory and the hash of its bytes as they are on disk, and of `copied`, the texts the output
 * copies, which are the runtime's modules and the templates of its declarations. A new version of
 * grai changes it, and so does a local change to any of them, which keeps the version.
 */
function compilerIdentity(copied: readonly string[]): string {
	const digest = createHash("sha1");
	for (const [file, hash] of partModules("compiler"))
		digest.update(file).update("\0").update(hash).update("\0");
	for (const text of copied) digest.update(text).update("\0");
	return digest.digest("hex");
}

/**
 * The modules of a part of grai, each by its path in grai's directory with the hash of its bytes,
 * in the order of their paths. They are the chunks grai's build lists for the part, while each is
 * as built. Otherwise, as in a patched install or in grai's own source, they are every module of
 * grai's directory, as no list of them is then sure. Hashing the listed chunks costs a start about
 * 1 ms, against about 7 ms for every module.
 */
export function partModules(part: BuiltPart): ReadonlyMap<string, string> {
	const modules = builtModules(part) ?? digests(everyModule());
	return new Map([...modules].sort(([a], [b]) => (a < b ? -1 : 1)));
}

/** The hash of a module's bytes. */
export function digestOf(bytes: Buffer): string {
	return createHash("sha1").update(bytes).digest("hex");
}

function digests(modules: ReadonlyMap<string, Buffer>): Map<string, string> {
	return new Map([...modules].map(([file, bytes]) => [file, digestOf(bytes)]));
}

/**
 * A part's chunks as grai's build lists them, each with the hash of its bytes: if the build lists
 * them, each is as built, and the compiler's hold the module that finds grai's files, so that the
 * list is that of the directory this code runs from.
 */
function builtModules(part: BuiltPart): Map<string, string> | undefined {
	let listed: unknown;
	try {
		listed = JSON.parse(readFileSync(join(root, builtModulesFile), "utf8"));
	} catch {
		return undefined;
	}
	const chunks =
		typeof listed === "object" && listed !== null && part in listed
			? (listed as Record<BuiltPart, unknown>)[part]
			: undefined;
	if (typeof chunks !== "object" || chunks === null) return undefined;
	const modules = new Map<string, string>();
	for (const [path, built] of Object.entries(chunks)) {
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
	if (part === "compiler" && !modules.has(relative(root, packageFilesModule)))
		return undefined;
	return modules;
}

/**
 * Every module of grai's directory, by its path in it, and the templates of its declarations,
 * when a part's own are not those its build lists.
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
function within(directory: string, file: string): boolean {
	const path = relative(directory, file);
	return (
		path !== "" &&
		path !== ".." &&
		!path.startsWith(`..${sep}`) &&
		!isAbsolute(path)
	);
}
