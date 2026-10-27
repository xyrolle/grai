// The modules of a Next app that a route's files reach, as Turbopack compiles them, and on which
// side: past a "use client" module, a module is the client's, which the SSR and browser layers
// compile. A module reached is compiled whole with every module it imports. A module whose code
// only re-exports is seen through to the modules that hold the names its importers take, and to
// those whose package keeps their side effects, which the bundler loads with it whatever is taken
// (`module-links.ts`): an app's own modules keep theirs, unless its package.json says otherwise.
import type { ModuleFacts } from "../code/facts.ts";
import { PackageEffects } from "../code/package-effects.ts";
import type { ProjectCode } from "../code/project.ts";
import { type ModuleLink, takenThrough, union } from "../module-links.ts";

/** A module a route reaches, by its path, and whether on the client's side. */
export type Reached = { path: string; client: boolean };

/** A module to visit: by its path, on which side, and the names its importers take from it. */
type Visit = Reached & { takes: ReadonlySet<string> | "*" };

/**
 * The project's modules a route's files reach: each module of the sources once on each side.
 * A module the sources do not hold, a package's or the output's, reads none of the app's keys and
 * is not followed. Imports for types alone load nothing. What it learns of packages and of the
 * names each module exports, it keeps for the routes after.
 */
export function routeReach(
	code: ProjectCode,
): (files: readonly string[]) => Promise<Reached[]> {
	const effects = new PackageEffects();
	const exported = exportedNames(code);
	return async (files) => {
		const reached: Reached[] = [];
		const taken = new Map<string, ReadonlySet<string> | "*">();
		const pending: Visit[] = files.map((path) => ({
			path,
			client: false,
			takes: "*",
		}));
		for (let next = pending.pop(); next !== undefined; next = pending.pop()) {
			const facts = code.sources.get(next.path)?.facts;
			if (facts === undefined || "error" in facts) continue;
			const client =
				next.client ||
				facts.modules.some(({ directives }) =>
					directives.includes("use client"),
				);
			const seenAs = `${client}\0${next.path}`;
			const before = taken.get(seenAs);
			const takes =
				before === undefined ? next.takes : union([before, next.takes]);
			if (before !== undefined && covers(before, takes)) continue;
			taken.set(seenAs, takes);
			if (before === undefined) reached.push({ path: next.path, client });
			const reexportsOnly = facts.modules.every(
				(module) => module.reexportsOnly,
			);
			for (const module of facts.modules) {
				const links = linksOf(module);
				const named = namedIn(links);
				for (const link of links) {
					const target = await code.graph.resolve(link.source, next.path);
					if (target === undefined || !code.sources.has(target)) continue;
					// An `export *` passes on a name only when its source exports it, and never
					// `default` or a name the module re-exports by name. A client component's module,
					// crossed into from the server's side, is a client reference there, whose names
					// Next's bundler does not know: it keeps every such branch (measured in `next dev`).
					const theirs =
						link.exports === "*" && (client || !isClientModule(code, target))
							? await exported(target)
							: "*";
					const passed =
						link.exports === undefined
							? reexportsOnly
								? undefined
								: link.takes
							: takenThrough(
									link,
									takes,
									(name) =>
										name !== "default" &&
										!named.has(name) &&
										(theirs === "*" || theirs.has(name)),
								);
					if (passed === undefined && !effects.keeps(target)) continue;
					pending.push({ path: target, client, takes: passed ?? new Set() });
				}
			}
		}
		return reached;
	};
}

/** Whether a module of the sources opens with "use client". */
function isClientModule(code: ProjectCode, path: string): boolean {
	const facts = code.sources.get(path)?.facts;
	return (
		facts !== undefined &&
		!("error" in facts) &&
		facts.modules.some(({ directives }) => directives.includes("use client"))
	);
}

/** The names a module's links re-export by name, which no `export *` beside them passes on. */
function namedIn(links: readonly ModuleLink[]): ReadonlySet<string> {
	return new Set(
		links.flatMap(({ exports }) =>
			exports instanceof Map ? [...exports.keys()] : [],
		),
	);
}

/**
 * The names each module of the sources exports, by its path, an `export *`'s too, which passes on
 * each name its source exports but `default`; `*`, any name, for a module the sources do not hold,
 * whose exports the walk does not know.
 */
function exportedNames(
	code: ProjectCode,
): (path: string) => Promise<ReadonlySet<string> | "*"> {
	const known = new Map<string, Promise<ReadonlySet<string> | "*">>();
	const of = async (
		path: string,
		seen: ReadonlySet<string>,
	): Promise<ReadonlySet<string> | "*"> => {
		const facts = code.sources.get(path)?.facts;
		if (facts === undefined || "error" in facts) return "*";
		// A cycle of `export *` adds no name.
		if (seen.has(path)) return new Set();
		const names = new Set<string>();
		for (const module of facts.modules) {
			for (const fact of module.exports) {
				if (fact.exported !== undefined) {
					names.add(fact.exported);
					continue;
				}
				if (!("source" in fact)) continue;
				const source = await code.graph.resolve(fact.source, path);
				if (source === undefined) continue;
				const theirs = await of(source, new Set([...seen, path]));
				if (theirs === "*") return "*";
				for (const name of theirs) if (name !== "default") names.add(name);
			}
		}
		return names;
	};
	return (path) => {
		let names = known.get(path);
		if (names === undefined) {
			names = of(path, new Set());
			known.set(path, names);
		}
		return names;
	};
}

/** Whether names taken before cover those taken now. */
function covers(
	before: ReadonlySet<string> | "*",
	now: ReadonlySet<string> | "*",
): boolean {
	if (before === "*") return true;
	return now !== "*" && [...now].every((name) => before.has(name));
}

/**
 * A module's links from its facts, as `moduleLinks` reads them from its code: each import with the
 * names it takes, each re-export with the names it passes on, and each `export *`. A dynamic import
 * and an import for its effects alone take every name, as nothing says which they read.
 */
function linksOf(module: ModuleFacts): ModuleLink[] {
	return module.imports.flatMap((fact): ModuleLink[] => {
		if (fact.typeOnly) return [];
		if (fact.reexports.length > 0) {
			const exports = new Map(
				fact.reexports.map(({ exported, imported }) => [exported, imported]),
			);
			return [
				{ source: fact.source, takes: new Set(exports.values()), exports },
			];
		}
		const star = module.exports.find(
			(each) =>
				"source" in each &&
				each.source === fact.source &&
				each.imported === "*",
		);
		if (star !== undefined) {
			const exports =
				star.exported === undefined ? "*" : new Map([[star.exported, "*"]]);
			return [{ source: fact.source, takes: "*", exports }];
		}
		const names = fact.names.map(({ imported }) => imported);
		const takes =
			names.length === 0 || names.includes("*") ? "*" : new Set(names);
		return [{ source: fact.source, takes }];
	});
}
