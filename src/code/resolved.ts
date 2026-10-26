/**
 * Every import a project's sources make, resolved up front in the pool (`pool.ts`), in tasks of
 * `taskImports`: what each module imports and exports from, and each dynamic import of a path. A
 * worker that only resolves costs about `resolverStart` to start, so the pool pays for a project
 * whose imports take this thread more than twice that.
 */

import type { FileFacts } from "./facts.ts";
import type { Pool } from "./pool.ts";
import type { Resolution } from "./resolution.ts";

/** What a worker that resolves costs to start, measured: about 80 ms. */
export const resolverStart = 80;

/** A task's imports: few enough messages for the threads, small enough tasks to share out evenly. */
const taskImports = 2_000;

/** An import from a file: what it names, and the file. */
type Import = { source: string; importer: string };

/**
 * Where each import of the sources resolves, or undefined for one that names no file, by the
 * importer and the path it names (`importKey`).
 */
export async function resolvedImports(
	sources: ReadonlyMap<string, { facts: FileFacts }>,
	resolution: Resolution,
	resolve: (source: string, importer: string) => string | undefined,
	pool: Pool,
): Promise<Map<string, string | undefined>> {
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
	const tasks: {
		kind: "resolve";
		resolution: Resolution;
		imports: Import[];
	}[] = [];
	for (const each of imports.values()) {
		const last = tasks.at(-1);
		if (last === undefined || last.imports.length >= taskImports) {
			tasks.push({ kind: "resolve", resolution, imports: [each] });
		} else {
			last.imports.push(each);
		}
	}
	const paths = await pool.run(tasks, {
		here: async (task) =>
			task.imports.map(({ source, importer }) => resolve(source, importer)),
		there: (answer) => answer.map((path) => (path === "" ? undefined : path)),
		size: (task) => task.imports.length,
		start: resolverStart,
	});
	const resolved = new Map<string, string | undefined>();
	tasks.forEach((task, index) => {
		task.imports.forEach(({ source, importer }, at) => {
			resolved.set(importKey(source, importer), paths[index]?.[at]);
		});
	});
	return resolved;
}

/** The key an import is resolved under: its importer and the path it names. */
export function importKey(source: string, importer: string): string {
	return `${importer}\0${source}`;
}
