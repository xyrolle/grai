import type { Compilation, CompiledKey } from "./compilation.ts";
import type { Config } from "./config.ts";
import {
	type BaseCatalog,
	type DeclarationLine,
	shardMap,
} from "./declaration-maps.ts";
import { runtimeDeclarations, serverDeclarations } from "./declarations.ts";
import { formatModule } from "./formats.ts";
import type { RuntimeFunction } from "./modules.ts";
import { pluralModule, pluralName } from "./plurals.ts";

/** The output's files, level by level: a file imports only files of earlier levels. */
export type Output = readonly (readonly (readonly [string, string])[])[];

/** The output's files by name, in write order, and each shard's keys, sorted. */
export type Rendered = {
	files: ReadonlyMap<string, string>;
	shards: readonly (readonly string[])[];
	/** Each shard's keys, with the line of the shard's declarations each one is on. */
	lines: readonly (readonly DeclarationLine[])[];
};

/** About how many keys a shard holds, so an edit rewrites one small module and its declarations. */
const keysPerShard = 512;

/**
 * Renders the output. The keys are split into shards by a hash of their name, so a key stays in
 * its shard while others come and go; only the shards whose keys changed are rendered again.
 */
export function renderOutput(
	config: Config,
	runtime: { runtime: string; server: string },
	compilation: Compilation,
	base: BaseCatalog,
	previous?: Rendered,
): { output: Output; rendered: Rendered } {
	const count = shardCount(compilation.keys.size);
	const before = previous?.shards.length === count ? previous : undefined;
	const dirty = new Set<number>();
	for (const key of compilation.changed) dirty.add(shardOf(key, count));
	const shards =
		before === undefined
			? groupKeys(compilation.keys.keys(), count)
			: before.shards.map((keys, index) =>
					dirty.has(index) ? regroup(keys, index, count, compilation) : keys,
				);
	const declarations: [string, string][] = [];
	const modules: [string, string][] = [];
	const lines: (readonly DeclarationLine[])[] = [];
	shards.forEach((keys, index) => {
		lines[index] = [];
		if (keys.length === 0) return;
		const js = `keys/${index}.js`;
		const dts = `keys/${index}.d.ts`;
		const module = dirty.has(index) ? undefined : before?.files.get(js);
		const declaration = dirty.has(index) ? undefined : before?.files.get(dts);
		const kept = before?.lines[index];
		const shard =
			module !== undefined && declaration !== undefined && kept !== undefined
				? { module, declarations: declaration, lines: kept }
				: renderShard(index, keys, compilation);
		const map = shardMap(index, shard.lines, base, config.outdir, {
			map: before?.files.get(`${dts}.map`),
			lines: kept,
		});
		lines[index] = shard.lines;
		modules.push([js, shard.module]);
		declarations.push([dts, shard.declarations], [`${dts}.map`, map]);
	});
	const keysIndex = modules
		.map(([file]) => `export * from "./${file}";\n`)
		.join("");
	const output: Output = [
		[
			["config.js", configModule(config)],
			["runtime.d.ts", runtimeDeclarations(config)],
			["server.d.ts", serverDeclarations],
			["plurals.js", pluralModule(config.locales)],
			...formatsFile(compilation),
		],
		[["runtime.js", runtime.runtime], ...declarations],
		[["server.js", runtime.server]],
		[...modules, ["keys.d.ts", keysIndex]],
		[
			["keys.js", keysIndex],
			["messages.d.ts", `export * as m from "./keys.js";\n`],
		],
		[["messages.js", `export * as m from "./keys.js";\n`]],
	];
	return {
		output,
		rendered: { files: new Map(output.flat()), shards, lines },
	};
}

/** formats.js, when a message calls a formatter. */
function formatsFile(compilation: Compilation): [string, string][] {
	if (compilation.formatted.size === 0) return [];
	const formatters = [...compilation.formatted].flatMap((key) => [
		...(compilation.keys.get(key)?.formats.values() ?? []),
	]);
	return [["formats.js", formatModule(formatters)]];
}

/** Every key in its shard, each shard's keys sorted. */
function groupKeys(keys: Iterable<string>, count: number): string[][] {
	const shards = Array.from({ length: count }, (): string[] => []);
	for (const key of keys) shards[shardOf(key, count)]?.push(key);
	for (const shard of shards) shard.sort();
	return shards;
}

/** A shard's keys, sorted, after the changed keys of that shard came or went. */
function regroup(
	keys: readonly string[],
	index: number,
	count: number,
	compilation: Compilation,
): string[] {
	const next = new Set(keys);
	for (const key of compilation.changed) {
		if (shardOf(key, count) !== index) continue;
		if (compilation.keys.has(key)) next.add(key);
		else next.delete(key);
	}
	return [...next].sort();
}

function shardModule(keys: readonly CompiledKey[]): string {
	const uses = new Set<RuntimeFunction>();
	const plurals = new Set<string>();
	const formats = new Set<string>();
	for (const key of keys) {
		for (const name of key.uses) uses.add(name);
		for (const locale of key.plurals) plurals.add(pluralName(locale));
		for (const name of key.formats.keys()) formats.add(name);
	}
	const imports = [
		`import { ${[...uses].sort().join(", ")} } from "../runtime.js";\n`,
	];
	if (plurals.size > 0) {
		imports.push(
			`import { ${[...plurals].sort().join(", ")} } from "../plurals.js";\n`,
		);
	}
	if (formats.size > 0) {
		imports.push(
			`import { ${[...formats].sort().join(", ")} } from "../formats.js";\n`,
		);
	}
	const code = keys.map((key) => key.code).join("");
	return `${imports.join("")}\n${code}`;
}

/** A shard's module and declarations, and the line each declaration is on. */
type Shard = {
	module: string;
	declarations: string;
	lines: readonly DeclarationLine[];
};

function renderShard(
	index: number,
	keys: readonly string[],
	compilation: Compilation,
): Shard {
	const compiled: CompiledKey[] = [];
	const types = keys.some((key) => compilation.keys.get(key)?.markup)
		? "MarkupMessage, Message"
		: "Message";
	const parts = [`import type { ${types} } from "../runtime.js";\n\n`];
	const lines: DeclarationLine[] = [];
	let line = 2;
	for (const name of keys) {
		const key = compilation.keys.get(name);
		if (key === undefined) continue;
		compiled.push(key);
		line += key.declarationLines;
		lines.push([name, line - 1]);
		parts.push(key.declaration);
	}
	parts.push(`//# sourceMappingURL=${index}.d.ts.map\n`);
	return { module: shardModule(compiled), declarations: parts.join(""), lines };
}

/** A power of two, so a key changes shard only when the key count doubles. */
function shardCount(keys: number): number {
	let shards = 1;
	while (shards * keysPerShard < keys) shards *= 2;
	return shards;
}

/** The shard of a key: its name's FNV-1a hash, modulo the shard count. */
function shardOf(key: string, shards: number): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < key.length; index++) {
		hash = Math.imul(hash ^ key.charCodeAt(index), 0x01000193);
	}
	return (hash >>> 0) % shards;
}

/** config.js: the project's config, as the runtime reads it. */
function configModule(config: Config): string {
	return [
		`export const locales = ${JSON.stringify(config.locales)};`,
		`export const baseLocale = ${JSON.stringify(config.baseLocale)};`,
		`/** @type {readonly ("ltr" | "rtl")[]} */`,
		`export const directions = ${JSON.stringify(config.locales.map(directionOf))};`,
		`/** @type {readonly ("cookie" | "preferredLanguage" | "url")[]} */`,
		`export const strategy = ${JSON.stringify(config.strategy)};`,
		"/** @type {string | undefined} */",
		`export const cookieName = ${config.cookieName === undefined ? "undefined" : JSON.stringify(config.cookieName)};`,
		"",
	].join("\n");
}

/** Scripts written right to left. */
const rightToLeft = new Set([
	"Adlm",
	"Arab",
	"Hebr",
	"Mand",
	"Nkoo",
	"Rohg",
	"Samr",
	"Syrc",
	"Thaa",
	"Yezi",
]);

/** The direction a locale's script is written in, from its likely script. */
function directionOf(locale: string): "ltr" | "rtl" {
	const script = new Intl.Locale(locale).maximize().script;
	return script !== undefined && rightToLeft.has(script) ? "rtl" : "ltr";
}
