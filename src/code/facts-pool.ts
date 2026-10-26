/**
 * Files read into their facts, on this thread until the pool pays. A worker costs about
 * `workerStart` to start and load the parsers, so the reading starts here; once it has taken that
 * long and the rest would take more than twice it, the rest is shared among workers, each given at
 * least that much work, and no more of them than the machine's parallelism less one. Measured on
 * app B the pool pays from about a thousand files, on the synthetic project from about four
 * thousand, whose scripts are simpler, so what decides is the work, not the count.
 */

import { availableParallelism } from "node:os";
import { extname } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { type FileFacts, factsOf } from "./facts.ts";

/** What a worker costs to start and to load the parsers, measured: about a quarter of a second. */
const workerStart = 250;

/** A file to read. */
type File = { path: string; text: string };

/** Each file's facts, in the order given. */
export async function factsOfFiles(
	files: readonly File[],
): Promise<FileFacts[]> {
	const facts: FileFacts[] = [];
	const start = performance.now();
	for (const { path, text } of files) {
		facts.push(await factsOf(path, text));
		const elapsed = performance.now() - start;
		const left = files.length - facts.length;
		const rest = (elapsed / facts.length) * left;
		if (elapsed > workerStart && rest > 2 * workerStart) {
			const workers = Math.min(
				availableParallelism() - 1,
				Math.floor(rest / workerStart),
			);
			if (workers > 1) {
				return [
					...facts,
					...(await inWorkers(files.slice(facts.length), workers)),
				];
			}
		}
	}
	return facts;
}

/** Files shared among workers in batches of about equal size, read in parallel. */
async function inWorkers(
	files: readonly File[],
	workers: number,
): Promise<FileFacts[]> {
	const batches = Array.from({ length: workers }, () => ({
		files: [] as File[],
		indexes: [] as number[],
		bytes: 0,
	}));
	files.forEach((file, index) => {
		const lightest = batches.reduce((a, b) => (b.bytes < a.bytes ? b : a));
		lightest.files.push(file);
		lightest.indexes.push(index);
		lightest.bytes += file.text.length;
	});
	const script = new URL(
		`./facts-worker${extname(fileURLToPath(import.meta.url))}`,
		import.meta.url,
	);
	const results = new Array<FileFacts>(files.length);
	await Promise.all(
		batches.map(async (batch) => {
			const worker = new Worker(script);
			try {
				const facts = await new Promise<FileFacts[]>((resolve, reject) => {
					worker.once("message", resolve);
					worker.once("error", reject);
					worker.postMessage(batch.files);
				});
				facts.forEach((each, at) => {
					results[batch.indexes[at] ?? 0] = each;
				});
			} finally {
				await worker.terminate();
			}
		}),
	);
	return results;
}
