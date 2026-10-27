// The modules of a Next app that a route's files reach, as Turbopack compiles them, and on which
// side: past a "use client" module, a module is the client's, which the SSR and browser layers
// compile. A module reached is compiled whole with every module it imports. A module whose code
// only re-exports is seen through to the modules that hold the names its importers take, and to
// those whose package keeps their side effects, which the bundler loads with it whatever is taken
// (`module-links.ts`): an app's own modules keep theirs, unless its package.json says otherwise.
import type { ModuleFacts } from "../code/facts.ts";
import type { PackageEffects } from "../code/package-effects.ts";
import type { ProjectCode } from "../code/project.ts";
import { type ModuleLink, takenThrough, union } from "../module-links.ts";

/** A module a route reaches, by its path, and whether on the client's side. */
export type Reached = { path: string; client: boolean };

/** A module to visit: by its path, on which side, and the names its importers take from it. */
type Visit = Reached & { takes: ReadonlySet<string> | "*" };

/**
 * The project's modules a route's files reach: each module of the sources once on each side.
 * A module the sources do not hold, a package's or the output's, reads none of the app's keys and
 * is not followed. Imports for types alone load nothing.
 */
export async function reachedFrom(
	code: ProjectCode,
	effects: PackageEffects,
	files: readonly string[],
): Promise<Reached[]> {
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
			facts.modules.some(({ directives }) => directives.includes("use client"));
		const seenAs = `${client}\0${next.path}`;
		const before = taken.get(seenAs);
		const takes =
			before === undefined ? next.takes : union([before, next.takes]);
		if (before !== undefined && covers(before, takes)) continue;
		taken.set(seenAs, takes);
		if (before === undefined) reached.push({ path: next.path, client });
		const reexportsOnly = facts.modules.every((module) => module.reexportsOnly);
		for (const module of facts.modules) {
			for (const link of linksOf(module)) {
				const passed =
					link.exports === undefined
						? reexportsOnly
							? undefined
							: link.takes
						: takenThrough(link, takes, () => true);
				const target = await code.graph.resolve(link.source, next.path);
				if (target === undefined || !code.sources.has(target)) continue;
				if (passed === undefined && !effects.keeps(target)) continue;
				pending.push({ path: target, client, takes: passed ?? new Set() });
			}
		}
	}
	return reached;
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
