/**
 * Work shared between this thread and workers: a command's reading of its files and resolving of
 * their imports. Tasks are taken from one queue by whichever thread is free, this one included, so
 * a worker still starting holds nothing up. Workers start once the work pays (`workersFor`) and
 * serve the rest of the command, its resolving after its reading.
 */

import { availableParallelism } from "node:os";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { Resolution } from "./resolution.ts";

/** A pool's task: files to read into their facts' JSON, or imports to resolve, each from a file. */
export type Task =
	| { kind: "facts"; files: { path: string; text: string }[] }
	| {
			kind: "resolve";
			resolution: Resolution;
			imports: { source: string; importer: string }[];
	  };

/**
 * A worker's answer to a task: each file's facts as JSON, or each import's path, empty for one that
 * names no file.
 */
export type Answer = string[];

/** How a pool runs a kind of task, and what a worker for it costs to start, measured. */
export type Work<T extends Task, A> = {
	/** The task done on this thread. */
	here: (task: T) => Promise<A>;
	/** A worker's answer, as this thread takes it. */
	there: (answer: Answer) => A;
	/** How much work a task is, in the units its time is measured by: bytes or imports. */
	size: (task: T) => number;
	start: number;
};

export class Pool {
	private readonly workers: Worker[] = [];
	private readonly script = new URL(
		`./pool-worker${extname(fileURLToPath(import.meta.url))}`,
		import.meta.url,
	);

	/**
	 * Each task's answer, in order. This thread takes tasks until none is left, and once the work it
	 * did shows that the rest would pay for workers, it starts them, and they take tasks as they come
	 * up. With `here` false, only the workers `start` started take them.
	 */
	async run<T extends Task, A>(
		tasks: readonly T[],
		work: Work<T, A>,
		here = true,
	): Promise<A[]> {
		const answers = new Array<A>(tasks.length);
		let next = 0;
		const take = () => {
			const at = next++;
			const task = tasks[at];
			return task === undefined ? undefined : { at, task };
		};
		const serve = async (worker: Worker) => {
			for (let taken = take(); taken !== undefined; taken = take()) {
				answers[taken.at] = work.there(await answer(worker, taken.task));
			}
		};
		const serving = this.workers.map(serve);
		const total = tasks.reduce((sum, task) => sum + work.size(task), 0);
		const begun = performance.now();
		let done = 0;
		for (let taken = here ? take() : undefined; taken; taken = take()) {
			answers[taken.at] = await work.here(taken.task);
			done += work.size(taken.task);
			const wanted = workersFor(
				work.start,
				performance.now() - begun,
				done,
				total - done,
				availableParallelism(),
			);
			while (this.workers.length < wanted) serving.push(serve(this.started()));
			// A worker's answer comes in as an event, which this thread takes only between its tasks.
			await new Promise((resolve) => setImmediate(resolve));
		}
		await Promise.all(serving);
		return answers;
	}

	/** Starts `count` workers more, for a run that keeps this thread out. */
	start(count: number): void {
		for (let n = 0; n < count; n++) this.started();
	}

	/** Stops the workers, once the command needs them no more. */
	async close(): Promise<void> {
		await Promise.all(this.workers.map((worker) => worker.terminate()));
	}

	private started(): Worker {
		const worker = new Worker(this.script);
		this.workers.push(worker);
		return worker;
	}
}

/**
 * How many workers the rest of a run takes, from how long the work done so far took: none while it
 * has taken less than a worker's start or the rest would take less than two, then one for each
 * worker's start the rest would take, at most the parallelism less one, and none rather than one,
 * which would only add its start.
 */
export function workersFor(
	start: number,
	elapsed: number,
	done: number,
	left: number,
	parallelism: number,
): number {
	const rest = (elapsed / done) * left;
	if (elapsed <= start || rest <= 2 * start) return 0;
	const workers = Math.min(parallelism - 1, Math.floor(rest / start));
	return workers > 1 ? workers : 0;
}

/** A worker's answer to a task, or the error it failed with. */
function answer(worker: Worker, task: Task): Promise<Answer> {
	return new Promise((resolve, reject) => {
		const answered = (value: Answer) => {
			worker.off("error", failed);
			resolve(value);
		};
		const failed = (error: Error) => {
			worker.off("message", answered);
			reject(error);
		};
		worker.once("message", answered);
		worker.once("error", failed);
		worker.postMessage(task);
	});
}
