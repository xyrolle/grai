// Runs inside workerd for workerd.mjs: reads the request's locale index ITERATIONS times from
// AsyncLocalStorage, or from a module variable the request sets, and answers with the time taken.
import { AsyncLocalStorage } from "node:async_hooks";

const ITERATIONS = 10_000_000;
const storage = new AsyncLocalStorage();
let current = 1;

const reads = {
	als: () => {
		let sum = 0;
		for (let i = 0; i < ITERATIONS; i++) sum += storage.getStore();
		return sum;
	},
	variable: () => {
		let sum = 0;
		for (let i = 0; i < ITERATIONS; i++) sum += current;
		return sum;
	},
};

export default {
	fetch(request) {
		current = 1;
		const read = reads[new URL(request.url).pathname.slice(1)];
		const start = performance.now();
		const sum = storage.run(1, read);
		return Response.json({
			ms: performance.now() - start,
			nsPerRead: ((performance.now() - start) * 1e6) / ITERATIONS,
			sum,
		});
	},
};
