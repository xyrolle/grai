/**
 * What a module of a build links to, read from its code: each static import and re-export, with
 * the names it takes from its source. A module whose code only re-exports links an importer, as the
 * bundler does, only to the modules that hold the names the importer takes from it, and to those
 * whose side effects it keeps: the others it leaves out for that importer, and so does a key's reach.
 */

import type { ESTree } from "./code/parse.ts";

/**
 * One static import or re-export, by its source: the names it takes from the source (`"*"`, every
 * one, for a namespace or `export *`; none for a bare import), and for a re-export the names it
 * exports, each by the name it takes (`"*"` for `export * as ns`), or `"*"` for `export *`, which
 * exports each name the source does.
 */
export type ModuleLink = {
	source: string;
	takes: ReadonlySet<string> | "*";
	exports?: ReadonlyMap<string, string> | "*";
};

/** A module's static links, and whether its code is re-exports and nothing else. */
export type ModuleLinks = {
	links: readonly ModuleLink[];
	reexportsOnly: boolean;
};

/** A module's static imports and re-exports. Type-only ones link nothing. */
export function moduleLinks(program: ESTree.Program): ModuleLinks {
	const links: ModuleLink[] = [];
	let reexportsOnly = program.body.length > 0;
	for (const statement of program.body) {
		const link = linkOf(statement);
		if (link !== undefined) links.push(link);
		if (link?.exports === undefined) reexportsOnly = false;
	}
	return { links, reexportsOnly };
}

function linkOf(statement: ESTree.Statement): ModuleLink | undefined {
	if (statement.type === "ImportDeclaration") {
		if (statement.importKind === "type") return undefined;
		const takes = new Set<string>();
		for (const specifier of statement.specifiers) {
			if (specifier.type === "ImportNamespaceSpecifier")
				return { source: statement.source.value, takes: "*" };
			takes.add(
				specifier.type === "ImportDefaultSpecifier"
					? "default"
					: nameOf(specifier.imported),
			);
		}
		return { source: statement.source.value, takes };
	}
	if (statement.type === "ExportAllDeclaration") {
		if (statement.exportKind === "type") return undefined;
		const exports =
			statement.exported === null
				? "*"
				: new Map([[nameOf(statement.exported), "*"]]);
		return { source: statement.source.value, takes: "*", exports };
	}
	if (
		statement.type === "ExportNamedDeclaration" &&
		statement.source !== null &&
		statement.exportKind !== "type"
	) {
		const exports = new Map(
			statement.specifiers.map((specifier) => [
				nameOf(specifier.exported),
				nameOf(specifier.local),
			]),
		);
		return {
			source: statement.source.value,
			takes: new Set(exports.values()),
			exports,
		};
	}
	return undefined;
}

function nameOf(name: ESTree.ModuleExportName): string {
	return name.type === "Literal" ? name.value : name.name;
}

/** What the bundler tells of a module, as much as seeing through re-export modules needs. */
export type LinkedModule = {
	readonly importers: readonly string[];
	readonly importedIds: readonly string[];
	readonly exports: readonly string[];
	/** Whether a plugin's hook said the module keeps its side effects; null when none did. */
	readonly moduleSideEffects: boolean | "no-treeshake" | null;
};

/**
 * The bundler's resolution of a module's source: the module, and whether it keeps its side effects
 * as its package says (`sideEffects`); nothing when the source does not resolve.
 */
export type Resolve = (
	source: string,
	importer: string,
) => Promise<
	{ id: string; moduleSideEffects: boolean | "no-treeshake" | null } | undefined
>;

/** A re-export module's link, with the module it resolves to and whether the bundler may leave it out. */
type Resolved = { link: ModuleLink; id: string; leftOut: boolean };

/**
 * Each module's imports, for the modules whose imports change once re-export modules are seen
 * through: a module that takes names from a re-export module links instead to the modules that hold
 * them, and to the re-export module's modules whose side effects the bundler keeps, which it loads
 * with it. Only a re-export module with a module the bundler may leave out changes anything, so
 * only its importers' sources that may be it are resolved. `links` holds the modules whose code was
 * read; any other links as the bundler's graph has it.
 */
export async function seenThrough(
	links: ReadonlyMap<string, ModuleLinks>,
	graph: (id: string) => LinkedModule | null,
	resolve: Resolve,
): Promise<Map<string, string[]>> {
	const barrels = new Map<string, readonly Resolved[]>();
	for (const [id, { links: own, reexportsOnly }] of links) {
		if (!reexportsOnly) continue;
		const targets = await Promise.all(
			own.map((link) => resolve(link.source, id)),
		);
		const resolved = own.flatMap((link, at): Resolved[] => {
			const target = targets[at];
			if (target === undefined) return [];
			// A plugin's hook overrides what the module's package says.
			const sideEffects =
				graph(target.id)?.moduleSideEffects ?? target.moduleSideEffects;
			return [{ link, id: target.id, leftOut: sideEffects === false }];
		});
		// A source the bundler resolves and this cannot: its importers link as the graph has them.
		if (resolved.length === own.length) barrels.set(id, resolved);
	}
	/**
	 * Whether a module exports `name`. The graph lists a star re-export's names as `*`, so a
	 * re-export module's are followed through its own links: a name it re-exports by name first, as
	 * the language resolves an export, then each `export *`, which never passes `default` on.
	 */
	const exportsName = (
		id: string,
		name: string,
		seen: Set<string> = new Set(),
	): boolean => {
		const own = barrels.get(id);
		if (own === undefined) {
			const names = graph(id)?.exports ?? [];
			return names.includes(name) || names.includes("*");
		}
		if (seen.has(id)) return false;
		seen.add(id);
		if (namedIn(own).has(name)) return true;
		return (
			name !== "default" &&
			own.some(
				({ link, id: target }) =>
					link.exports === "*" && exportsName(target, name, seen),
			)
		);
	};

	/** Adds the modules that an importer taking `takes` from the re-export module `id` links to. */
	const holding = (
		id: string,
		takes: ReadonlySet<string> | "*",
		into: Set<string>,
		seen: ReadonlySet<string>,
	) => {
		const own = barrels.get(id) ?? [];
		const named = namedIn(own);
		for (const { link, id: target, leftOut } of own) {
			const taken = takenThrough(
				link,
				takes,
				(name) =>
					name !== "default" && !named.has(name) && exportsName(target, name),
			);
			if (taken === undefined && leftOut) continue;
			if (barrels.has(target) && !seen.has(target))
				holding(target, taken ?? new Set(), into, new Set(seen).add(target));
			else into.add(target);
		}
	};

	const changed = new Map<string, string[]>();
	for (const [barrel, resolved] of barrels) {
		// Seeing through one whose modules all keep their side effects would change nothing.
		if (!resolved.some(({ id, leftOut }) => leftOut || barrels.has(id)))
			continue;
		for (const importer of graph(barrel)?.importers ?? []) {
			const own = links.get(importer)?.links;
			// A re-export module's importers that only re-export too are seen through with it.
			if (own === undefined || barrels.has(importer)) continue;
			const candidates = own.filter(
				({ takes }) =>
					takes === "*" || [...takes].some((name) => exportsName(barrel, name)),
			);
			const targets = await Promise.all(
				candidates.map(({ source }) => resolve(source, importer)),
			);
			const takes = candidates.flatMap((link, at) =>
				targets[at]?.id === barrel ? [link.takes] : [],
			);
			if (takes.length === 0) continue;
			const into = new Set<string>();
			holding(barrel, union(takes), into, new Set([barrel]));
			const imports =
				changed.get(importer) ?? graph(importer)?.importedIds ?? [];
			changed.set(importer, [
				...new Set([...imports.filter((id) => id !== barrel), ...into]),
			]);
		}
	}
	return changed;
}

/** The names a re-export module's links re-export by name, which no `export *` beside them can. */
function namedIn(own: readonly Resolved[]): ReadonlySet<string> {
	return new Set(
		own.flatMap(({ link }) =>
			link.exports instanceof Map ? [...link.exports.keys()] : [],
		),
	);
}

/**
 * The names a link of a re-export module passes on to its source, for an importer that takes
 * `takes` from the re-export module: undefined when it passes none. An `export *` passes on those
 * `passes` says its source holds for it.
 */
export function takenThrough(
	link: ModuleLink,
	takes: ReadonlySet<string> | "*",
	passes: (name: string) => boolean,
): ReadonlySet<string> | "*" | undefined {
	const { exports } = link;
	if (exports === undefined) return undefined;
	if (exports === "*") {
		if (takes === "*") return "*";
		const taken = new Set([...takes].filter(passes));
		return taken.size === 0 ? undefined : taken;
	}
	const names = [...exports].flatMap(([exported, local]) =>
		takes === "*" || takes.has(exported) ? [local] : [],
	);
	if (names.length === 0) return undefined;
	return names.includes("*") ? "*" : new Set(names);
}

/** Every name any of these takes: `*` when one takes every name. */
export function union(
	all: readonly (ReadonlySet<string> | "*")[],
): ReadonlySet<string> | "*" {
	const names = new Set<string>();
	for (const takes of all) {
		if (takes === "*") return "*";
		for (const name of takes) names.add(name);
	}
	return names;
}
