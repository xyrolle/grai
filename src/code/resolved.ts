/**
 * The imports a project's sources make, resolved up front in the pool (`pool.ts`), in tasks of
 * `taskImports`: what each module imports and exports from, and each dynamic import of a path. A
 * worker that only resolves costs about `resolverStart` to start, so the pool pays for a project
 * whose imports take this thread more than twice that.
 *
 * Only the imports that may name what holds grai's are resolved, by the names the reading tests the
 * files' texts by (`text-test.ts`): an import that writes none of them names a module that holds
 * nothing of grai's, as a source that fails the test does. Such a module is `unnamed`, which the
 * reading takes for one that holds nothing. As the names grow, round by round, the imports kept
 * unresolved that the new names may name are resolved then.
 */

import type { FileFacts } from "./facts.ts";
import type { Pool } from "./pool.ts";
import type { Resolution } from "./resolution.ts";

/** What a worker that resolves costs to start, measured: about 80 ms. */
export const resolverStart = 80;

/** A task's imports: few enough messages for the threads, small enough tasks to share out evenly. */
const taskImports = 2_000;

/** The start of the path of a module an import names that holds nothing of grai's, unresolved. */
export const unnamed = "\0unnamed\0";

/** An import from a file: what it names, and the file. */
type Import = { source: string; importer: string };

/** Whether an import may name what holds grai's, so that it is resolved. */
export type Wanted = (source: string, importer: string) => boolean;

/** Where the sources' imports resolve, as far as the reading needs them. */
export class Resolutions {
	private readonly resolved = new Map<string, string | undefined>();
	private readonly kept = new Map<string, Import>();
	private readonly resolution: Resolution;
	private readonly resolveFile: (
		source: string,
		importer: string,
	) => string | undefined;
	private readonly pool: Pool;

	constructor(
		resolution: Resolution,
		resolveFile: (source: string, importer: string) => string | undefined,
		pool: Pool,
	) {
		this.resolution = resolution;
		this.resolveFile = resolveFile;
		this.pool = pool;
	}

	/** Resolves the imports of these sources that `wanted` takes, and keeps the rest unresolved. */
	async add(
		sources: ReadonlyMap<string, { facts: FileFacts }>,
		wanted: Wanted,
	): Promise<void> {
		const taken: Import[] = [];
		for (const each of importsOf(sources)) {
			if (wanted(each.source, each.importer)) taken.push(each);
			else this.kept.set(importKey(each.source, each.importer), each);
		}
		await this.resolveAll(taken);
	}

	/** Resolves the imports kept unresolved that `wanted` takes now; whether there were any. */
	async again(wanted: Wanted): Promise<boolean> {
		const taken: Import[] = [];
		for (const [key, each] of this.kept) {
			if (!wanted(each.source, each.importer)) continue;
			taken.push(each);
			this.kept.delete(key);
		}
		await this.resolveAll(taken);
		return taken.length > 0;
	}

	/** Where an import resolves: as resolved, `unnamed` for one kept unresolved, or by the resolver. */
	path(source: string, importer: string): string | undefined {
		const key = importKey(source, importer);
		if (this.resolved.has(key)) return this.resolved.get(key);
		if (this.kept.has(key)) return `${unnamed}${key}`;
		return this.resolveFile(source, importer);
	}

	private async resolveAll(imports: readonly Import[]): Promise<void> {
		if (imports.length === 0) return;
		const tasks: {
			kind: "resolve";
			resolution: Resolution;
			imports: Import[];
		}[] = [];
		for (const each of imports) {
			const last = tasks.at(-1);
			if (last === undefined || last.imports.length >= taskImports) {
				tasks.push({
					kind: "resolve",
					resolution: this.resolution,
					imports: [each],
				});
			} else {
				last.imports.push(each);
			}
		}
		const paths = await this.pool.run(tasks, {
			here: async (task) =>
				task.imports.map(({ source, importer }) =>
					this.resolveFile(source, importer),
				),
			there: (answer) => answer.map((path) => (path === "" ? undefined : path)),
			size: (task) => task.imports.length,
			start: resolverStart,
		});
		tasks.forEach((task, index) => {
			task.imports.forEach(({ source, importer }, at) => {
				this.resolved.set(importKey(source, importer), paths[index]?.[at]);
			});
		});
	}
}

/** Each import the sources make, once: what each module imports and exports from, and loads. */
function importsOf(
	sources: ReadonlyMap<string, { facts: FileFacts }>,
): Import[] {
	const imports = new Map<string, Import>();
	for (const [importer, { facts }] of sources) {
		if ("error" in facts) continue;
		for (const { imports: own, exports, loads } of facts.modules) {
			const named = [
				...own.map(({ source }) => source),
				...exports.flatMap((fact) => ("source" in fact ? [fact.source] : [])),
				...loads.flatMap((load) => ("source" in load ? [load.source] : [])),
			];
			for (const source of named) {
				imports.set(importKey(source, importer), { source, importer });
			}
		}
	}
	return [...imports.values()];
}

/** The key an import is resolved under: its importer and the path it names. */
function importKey(source: string, importer: string): string {
	return `${importer}\0${source}`;
}
