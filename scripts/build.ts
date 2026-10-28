// The package's build: its TypeScript sources bundled into dist, a module for each entry that
// package.json's `exports` and `bin` name and for each module grai runs by its path, and chunks of
// the modules they share, so that a start loads a few modules rather than one per source file. tsc
// writes each source module's declarations, which the entries' declarations import. The runtime's
// modules ship as they are written, with the templates of the output's declarations: the compiler
// copies those into every project's output, so neither the bundler nor tsc, which would print them
// anew, sees them. dist starts empty, so a module removed from src never ships. Last, the lists of
// the chunks the compiler and the code reader run, each with the hash of its bytes, which a start
// takes in place of hashing every module.
//
// usage: node scripts/build.ts
import { execFileSync } from "node:child_process";
import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { type OutputChunk, rolldown } from "rolldown";
import {
	type BuiltPart,
	builtModulesFile,
	digestOf,
} from "../src/compiler-identity.ts";

const dist = new URL("../dist/", import.meta.url);
const source = new URL("../src/", import.meta.url);
const tsc = new URL("../node_modules/typescript/bin/tsc", import.meta.url);
const project = new URL("../tsconfig.build.json", import.meta.url);

/**
 * The modules grai runs by their paths, beside the entries package.json names: the threads it
 * starts (`packageModule`), and Nuxt's runtime files, which its module adds to the app by path.
 */
const runByPath = [
	"next/watch-worker",
	"next/group-worker",
	"code/pool-worker",
	"nuxt/runtime/plugin",
	"nuxt/runtime/locale",
];

/** Each entry's name: its path in dist without `.js`, which is its source's in src without `.ts`. */
function entries(): string[] {
	const manifest: {
		exports: Record<string, Record<string, string>>;
		bin: Record<string, string>;
	} = JSON.parse(
		readFileSync(new URL("../package.json", import.meta.url), "utf8"),
	);
	const named = [
		...Object.values(manifest.exports).flatMap((conditions) =>
			Object.entries(conditions)
				.filter(([condition]) => condition !== "types")
				.map(([, path]) => path),
		),
		...Object.values(manifest.bin),
	].map((path) => path.replace(/^(\.\/)?dist\//, "").replace(/\.js$/, ""));
	return [...new Set([...named, ...runByPath])].sort();
}

rmSync(dist, { recursive: true, force: true });
execFileSync(
	process.execPath,
	[fileURLToPath(tsc), "-p", fileURLToPath(project), "--emitDeclarationOnly"],
	{ stdio: "inherit" },
);

const sourceOf = (entry: string) =>
	fileURLToPath(new URL(`${entry}.ts`, source));

/**
 * Each entry's module, by its source, with its file in dist. An entry stays the one module of its
 * own, whose file holds its code: a module that imports it imports its file, never a chunk the
 * bundler would share between them. What holds for an entry's module alone then holds still, as
 * Next's client provider's `"use client"`, or the effects package.json's `sideEffects` marks it
 * with, which a chunk the bundler named would lose.
 */
const built = new Map(
	entries().map((entry) => [
		sourceOf(entry),
		fileURLToPath(new URL(`${entry}.js`, dist)),
	]),
);

/** The directive a module opens with after its comments, as `"use client";`. */
const directiveOf = (text: string) =>
	/^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*((["'])use (?:client|server)\2;?)/.exec(
		text,
	)?.[1];

const logs: string[] = [];
const bundle = await rolldown({
	input: Object.fromEntries(entries().map((entry) => [entry, sourceOf(entry)])),
	platform: "node",
	// Every package grai imports, Node's modules and Nuxt's virtual ones: the app resolves them.
	external: (id) => !id.startsWith(".") && !isAbsolute(id),
	plugins: [
		{
			name: "entries-by-file",
			async resolveId(id, importer, options) {
				if (importer === undefined || !id.startsWith(".")) return null;
				const resolved = await this.resolve(id, importer, options);
				const target = resolved === null ? undefined : built.get(resolved.id);
				if (target === undefined) return null;
				// From the importer's file, which only an entry's code is sure to be in.
				const from = built.get(importer);
				if (from === undefined)
					this.error(
						`${importer} imports the entry ${resolved?.id}, but is no entry, whose file the import could start from.`,
					);
				const path = relative(dirname(from), target).replaceAll(sep, "/");
				return {
					id: path.startsWith(".") ? path : `./${path}`,
					external: true,
				};
			},
		},
	],
	onLog: (level, log) => {
		// An entry keeps its module's directive, as the check after the write makes sure, which the
		// bundler cannot tell.
		if (log.code === "MODULE_LEVEL_DIRECTIVE" && built.has(log.id ?? ""))
			return;
		logs.push(`${level}: ${log.message}`);
	},
});
const { output } = await bundle.write({
	dir: fileURLToPath(dist),
	format: "esm",
	entryFileNames: "[name].js",
	chunkFileNames: "[name]-[hash].js",
	// The module that finds grai's files by its own location, alone at dist's root.
	codeSplitting: {
		groups: [
			{ name: "package-files", test: /[\\/]src[\\/]package-files\.ts$/ },
		],
	},
});
await bundle.close();
// A warning is a part of the build the bundler could not make as written: none ships.
if (logs.length > 0) throw new Error(`The bundler warned:\n${logs.join("\n")}`);
for (const [module, file] of built) {
	const opening = directiveOf(readFileSync(module, "utf8"));
	if (opening !== undefined && !readFileSync(file, "utf8").startsWith(opening))
		throw new Error(`${file} does not open with its module's directive.`);
}

cpSync(new URL("runtime/", source), new URL("runtime/", dist), {
	recursive: true,
	filter: (file) => !file.endsWith(".d.ts"),
});

const chunks = output.filter(
	(item): item is OutputChunk => item.type === "chunk",
);
const byName = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));

/**
 * The chunks holding a module of a part, and every chunk they import in turn, statically or by
 * `import()`, each by its path in dist.
 */
function partChunks(holds: (module: string) => boolean): string[] {
	const found = new Set<string>();
	const unread = chunks
		.filter((chunk) => chunk.moduleIds.some(holds))
		.map((chunk) => chunk.fileName);
	for (let name = unread.pop(); name !== undefined; name = unread.pop()) {
		const chunk = byName.get(name);
		// A package's or Node's module, which a chunk imports by its name, is none of grai's.
		if (chunk === undefined || found.has(name)) continue;
		found.add(name);
		unread.push(...chunk.imports, ...chunk.dynamicImports);
	}
	return [...found].sort();
}

const sourceFile = (path: string) => fileURLToPath(new URL(path, source));
const parts: Record<BuiltPart, string[]> = {
	// A compile, and the read of its saved build.
	compiler: partChunks((module) =>
		[sourceFile("compile.ts"), sourceFile("saved-build.ts")].includes(module),
	),
	// The reader of an app's code, whose facts it keeps keyed on its chunks.
	reader: partChunks((module) => module.startsWith(sourceFile("code/"))),
};
writeFileSync(
	new URL(builtModulesFile, dist),
	`${JSON.stringify(
		Object.fromEntries(
			Object.entries(parts).map(([part, files]) => [
				part,
				Object.fromEntries(
					files.map((file) => [
						file,
						digestOf(readFileSync(new URL(file, dist))),
					]),
				),
			]),
		),
		null,
		"\t",
	)}\n`,
);
