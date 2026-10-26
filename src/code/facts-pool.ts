/**
 * Files read into their facts in the pool (`pool.ts`), in tasks of about `taskSize` of text each.
 * A worker costs about `workerStart` to start and load the parsers, which the pool sizes its
 * workers by (`workersFor`), from how fast this thread reads: what decides is the work, not the
 * count of files, as app B's scripts take longer than the synthetic project's.
 */

import { factsOf } from "./facts.ts";
import { type FactsRead, keptFacts, keptText } from "./facts-cache.ts";
import type { Pool } from "./pool.ts";

/** What a worker costs to start and to load the parsers, measured: about a quarter of a second. */
export const workerStart = 250;

/** A task's text: few enough messages for the threads, small enough tasks to share out evenly. */
const taskSize = 128 * 1024;

/** A file to read. */
type File = { path: string; text: string };

/**
 * Each file's facts, with the text the cache keeps them as, in the order given, read in the pool.
 * With `here` false, only the workers the pool has started read them.
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
					each.push({ facts, kept: keptText(facts) });
				}
				return each;
			},
			there: (answer) =>
				answer.map((kept) => ({ facts: keptFacts(kept), kept })),
			size: (task) =>
				task.files.reduce((sum, { text }) => sum + text.length, 0),
			start: workerStart,
		},
		here,
	);
	return read.flat();
}
