import type { Compilation, CompiledKey } from "./compilation.ts";
import type { Config } from "./config.ts";
import { runtimeDeclarations, serverDeclarations } from "./declarations.ts";
import type { RuntimeFunction } from "./modules.ts";
import { pluralModule, pluralName } from "./plurals.ts";

/** The output's files, level by level: a file imports only files of earlier levels. */
export type Output = readonly (readonly (readonly [string, string])[])[];

/** The output's files by name, in write order, and each shard's keys, sorted. */
export type Rendered = {
	files: ReadonlyMap<string, string>;
	shards: readonly (readonly string[])[];
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
	shards.forEach((keys, index) => {
		if (keys.length === 0) return;
		const js = `keys/${index}.js`;
		const dts = `keys/${index}.d.ts`;
		const module = dirty.has(index) ? undefined : before?.files.get(js);
		const declaration = dirty.has(index) ? undefined : before?.files.get(dts);
		if (module !== undefined && declaration !== undefined) {
			modules.push([js, module]);
			declarations.push([dts, declaration]);
			return;
		}
		const compiled = keys.flatMap((key) => compilation.keys.get(key) ?? []);
		modules.push([js, shardModule(compiled)]);
		declarations.push([dts, shardDeclarations(compiled)]);
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
	return { output, rendered: { files: new Map(output.flat()), shards } };
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
	for (const key of keys) {
		for (const name of key.uses) uses.add(name);
		for (const locale of key.plurals) plurals.add(pluralName(locale));
	}
	const imports = [
		`import { ${[...uses].sort().join(", ")} } from "../runtime.js";\n`,
	];
	if (plurals.size > 0) {
		imports.push(
			`import { ${[...plurals].sort().join(", ")} } from "../plurals.js";\n`,
		);
	}
	const code = keys.map((key) => key.code).join("");
	return `${imports.join("")}\n${code}`;
}

function shardDeclarations(keys: readonly CompiledKey[]): string {
	const types = keys.some((key) => key.markup)
		? "MarkupMessage, Message"
		: "Message";
	const declarations = keys.map((key) => key.declaration).join("");
	return `import type { ${types} } from "../runtime.js";\n\n${declarations}`;
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
		`export const strategy = ${JSON.stringify(config.strategy)};`,
		`export const cookieName = ${config.cookieName === undefined ? "undefined" : JSON.stringify(config.cookieName)};`,
		"",
	].join("\n");
}
