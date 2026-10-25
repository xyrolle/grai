// Runs inside workerd for server-pages.mjs: imports one page, then every page, then renders each
// once, and answers with the times, as the bench's Node process does.
import { pages } from "./pages.js";

export default {
	async fetch() {
		const start = performance.now();
		const first = await import(`./${pages[0]}`);
		const one = performance.now();
		const rest = await Promise.all(
			pages.slice(1).map((page) => import(`./${page}`)),
		);
		const every = performance.now();
		let length = 0;
		for (const page of [first, ...rest]) length += page.render().length;
		const rendered = performance.now();
		return Response.json({
			one: one - start,
			every: every - start,
			render: rendered - every,
			length,
		});
	},
};
