// A SvelteKit app's browser build as record-build.mjs recorded it, read back for bytes.mjs: each
// page by route, with the files it loads (its nodes' chunks and all they import, as Kit preloads
// them), the message keys those files hold, and the keys their code names. A build on Paraglide
// holds a key in a module of its own; a build on grai, in a module grai's plugin names by the key.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { graiParts } from "./grai.mjs";

const { keyModulePrefix, textModulePrefix } = await import(graiParts);

/** Code's size, raw and brotli at the quality a host precompresses with. */
export function sizes(code) {
	const bytes = Buffer.from(code);
	return {
		raw: bytes.length,
		brotli: brotliCompressSync(bytes, {
			params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
		}).length,
	};
}

export const NOTHING = { raw: 0, brotli: 0 };

/** Sizes added up. */
export const sum = (all) =>
	all.reduce(
		(total, size) => ({
			raw: total.raw + size.raw,
			brotli: total.brotli + size.brotli,
		}),
		NOTHING,
	);

/** The key a module holds: a grai key's module id, or a Paraglide message module's export. */
const keyOfModule = new Map();
function keyOf(id) {
	for (const prefix of [keyModulePrefix, textModulePrefix])
		if (id.startsWith(prefix)) return id.slice(prefix.length);
	if (!/\/paraglide\/messages\/(?!_index)[^/]+\.js$/.test(id)) return undefined;
	if (!keyOfModule.has(id)) {
		const code = readFileSync(id, "utf8");
		keyOfModule.set(
			id,
			code.match(/export \{ \w+ as "([^"]+)" \}/)?.[1] ??
				code.match(/export const (\w+) =/)?.[1],
		);
	}
	return keyOfModule.get(id);
}

/**
 * The record at `path`: the app's root, its pages by route id, each `{ files, keys, used }`, with
 * `used` the keys of `catalog` its code names, and `sizeOf(file)`, a file's size as written.
 */
export function readBuild(path, catalog) {
	const record = JSON.parse(readFileSync(path, "utf8"));
	const client = join(record.root, ".svelte-kit/output/client");
	const chunks = new Map(record.chunks.map((chunk) => [chunk.file, chunk]));
	const nodeChunk = new Map();
	for (const chunk of record.chunks)
		if (chunk.facade && basename(dirname(chunk.facade)) === "nodes")
			nodeChunk.set(Number(basename(chunk.facade, ".js")), chunk.file);
	const closure = (files, into = new Set()) => {
		for (const file of files) {
			if (into.has(file)) continue;
			into.add(file);
			closure(chunks.get(file)?.imports ?? [], into);
		}
		return into;
	};
	const written = new Map();
	/** A file's size as written, or undefined: Vite drops a chunk that held only CSS. */
	const sizeOf = (file) => {
		if (!written.has(file))
			written.set(
				file,
				existsSync(join(client, file))
					? sizes(readFileSync(join(client, file)))
					: undefined,
			);
		return written.get(file);
	};
	const pages = new Map();
	for (const route of record.routes) {
		const files = closure([
			...record.entry,
			...route.nodes.map((node) => nodeChunk.get(node)).filter(Boolean),
		]);
		const keys = new Set();
		const used = new Set();
		for (const file of files)
			for (const [id, length] of Object.entries(
				chunks.get(file)?.modules ?? {},
			)) {
				const key = keyOf(id);
				if (key) keys.add(key);
				else if (length > 0)
					for (const named of record.references[id] ?? [])
						if (named in catalog) used.add(named);
			}
		pages.set(route.id, { files: [...files], keys: [...keys], used });
	}
	return { root: record.root, pages, sizeOf };
}
