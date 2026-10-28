// Which of a Next app's routes read each key, and on which side. A route's server side is its
// server components, which Next's RSC layer compiles; its client side is every module past a
// "use client" one, which the SSR and browser layers both compile (`route-reach.ts`). Each route's
// side is a context, and a key's contexts are those whose modules read it.
import { add, type Bits, bits } from "../bits.ts";
import type { Span } from "../code/facts.ts";
import type { ProjectCode } from "../code/project.ts";
import type { Reading } from "../code/reads.ts";
import { routeReach } from "./route-reach.ts";
import type { Route } from "./routes.ts";

/** How many contexts there are, and each read key's, by name. */
export type KeyContexts = { count: number; of: Map<string, Bits> };

/** The context of a route's side: two to a route, its server side and its client side. */
const contextOf = (route: number, client: boolean) =>
	route * 2 + Number(client);

/**
 * Each read key's contexts among `keys`, from the reading of the project's code and the module
 * graph its sources' imports make, followed from each route's files. A module the graph reaches
 * outside the sources, a package's, reads none of the app's keys and is not followed.
 */
export async function keyContexts(
	code: ProjectCode,
	reading: Reading,
	routes: readonly Route[],
	keys: readonly string[],
): Promise<KeyContexts> {
	const count = routes.length * 2;
	const of = new Map<string, Bits>();
	const readBy = keysReadBy(code, reading, keys);
	const reach = routeReach(code);
	for (const [index, route] of routes.entries()) {
		for (const { path, client } of await reach(route.files)) {
			for (const key of readBy.get(path) ?? []) {
				let contexts = of.get(key);
				if (contexts === undefined) {
					contexts = bits(count);
					of.set(key, contexts);
				}
				add(contexts, contextOf(index, client));
			}
		}
	}
	return { count, of };
}

/**
 * The keys each module reads, by its path: those it names, and those a read that may reach more
 * keys may (every key that starts with its prefix, or each of its choices). A read for a type
 * alone loads nothing. A re-export of a key (`export { title } from`) reads it only for the
 * importers that take it, whose own reads name it, through the module that re-exports it.
 */
function keysReadBy(
	code: ProjectCode,
	reading: Reading,
	keys: readonly string[],
): Map<string, Set<string>> {
	const readBy = new Map<string, Set<string>>();
	const read = (path: string, key: string) => {
		const known = readBy.get(path);
		if (known === undefined) readBy.set(path, new Set([key]));
		else known.add(key);
	};
	const reexports = reexportsByPath(code);
	for (const { path, at, key, type } of reading.reads) {
		if (!type && !reexported(reexports.get(path), at)) read(path, key);
	}
	for (const { path, prefix, choices, type } of reading.reaches) {
		if (type) continue;
		const reached = choices ?? keys.filter((key) => key.startsWith(prefix));
		for (const key of reached) read(path, key);
	}
	return readBy;
}

/**
 * Where each source's re-exports are, by the source's path: the names a re-export takes, and the
 * path of each re-export from a key's own path (`export { title } from "#i18n/messages/title.js"`),
 * which the reading reads at the key's name in it.
 */
function reexportsByPath(code: ProjectCode): Map<string, ReexportPlaces> {
	const reexports = new Map<string, ReexportPlaces>();
	for (const [path, { facts }] of code.sources) {
		if ("error" in facts) continue;
		const places: ReexportPlaces = { names: new Set(), paths: [] };
		for (const module of facts.modules) {
			const stars = new Set(
				module.exports.flatMap((fact) =>
					"source" in fact && fact.exported === undefined ? [fact.source] : [],
				),
			);
			for (const fact of module.imports) {
				for (const { importedAt } of fact.reexports)
					places.names.add(importedAt.start);
				if (fact.reexports.length > 0 || stars.has(fact.source))
					places.paths.push(fact.path);
			}
		}
		if (places.names.size + places.paths.length > 0)
			reexports.set(path, places);
	}
	return reexports;
}

/** A source's re-exports: where each name a re-export takes is, and each re-export's path. */
type ReexportPlaces = { names: Set<number>; paths: Span[] };

/** Whether a read is a re-export's, by where it is. */
function reexported(places: ReexportPlaces | undefined, at: Span): boolean {
	if (places === undefined) return false;
	return (
		places.names.has(at.start) ||
		places.paths.some(({ start, end }) => at.start >= start && at.start < end)
	);
}
