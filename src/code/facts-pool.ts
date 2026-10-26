/**
 * Files read into their facts in the pool (`pool.ts`), in tasks of about `taskSize` of text each.
 * A worker costs about `workerStart` to start and load the parsers, so this thread reads alone until
 * the reading has taken that long and the rest would take more than twice it. Measured on app B the
 * pool pays from about a thousand files, on the synthetic project from about four thousand, whose
 * scripts are simpler, so what decides is the work, not the count.
 */

import { factsOf } from "./facts.ts";
import type { FactsRead } from "./facts-cache.ts";
import type { Pool } from "./pool.ts";

/** What a worker costs to start and to load the parsers, measured: about a quarter of a second. */
export const workerStart = 250;

/** A task's text: few enough messages for the threads, small enough tasks to share out evenly. */
const taskSize = 128 * 1024;

/** A file to read. */
type File = { path: string; text: string };

/**
 * Each file's facts, with their JSON, in the order given, read in the pool. With `here` false, only
 * the workers the pool has started read them.
 */
export async function factsOfFiles(
	files: readonly File[],
	pool: Pool,
	here = true,
): Promise<FactsRead[]> {
	const tasks: { kind: "facts"; files: File[] }[] = [];
	let size = taskSize;
	for (const { path, text } of files) {
		if (size >= taskSize) {
			tasks.push({ kind: "facts", files: [] });
			size = 0;
		}
		tasks.at(-1)?.files.push({ path, text });
		size += text.length;
	}
	const read = await pool.run(
		tasks,
		{
			here: async (task) => {
				const each: FactsRead[] = [];
				for (const { path, text } of task.files) {
					const facts = await factsOf(path, text);
					each.push({ facts, json: JSON.stringify(facts) });
				}
				return each;
			},
			there: (answer) =>
				answer.map((json) => ({ facts: JSON.parse(json), json })),
			size: (task) =>
				task.files.reduce((sum, { text }) => sum + text.length, 0),
			start: workerStart,
		},
		here,
	);
	return read.flat();
}
