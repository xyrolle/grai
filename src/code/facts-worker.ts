/** A worker of the facts pool: each batch of files it is sent, read into their facts. */

import { parentPort } from "node:worker_threads";
import { factsOf } from "./facts.ts";

parentPort?.on(
	"message",
	async (files: readonly { path: string; text: string }[]) => {
		const facts = [];
		for (const { path, text } of files) facts.push(await factsOf(path, text));
		parentPort?.postMessage(facts);
	},
);
