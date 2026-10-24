// The locale read on Cloudflare's runtime: an AsyncLocalStorage read against a module variable,
// timed inside a local workerd started by Wrangler (workerd-worker.js), median of 7 requests each.
//   node workerd.mjs
import { unstable_startWorker } from "wrangler";

const worker = await unstable_startWorker({
	name: "grai-bench",
	entrypoint: new URL("workerd-worker.js", import.meta.url).pathname,
	compatibilityDate: "2026-10-01",
	compatibilityFlags: ["nodejs_compat"],
	dev: { server: { port: 0 }, inspector: false, logLevel: "none" },
});
const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
console.log(
	"\n### the locale read inside workerd, ns per read\n\n| read | ns |\n|---|---|",
);
for (const read of ["als", "variable"]) {
	const samples = [];
	for (let run = 0; run < 7; run++)
		samples.push(
			(await (await worker.fetch(`http://bench/${read}`)).json()).nsPerRead,
		);
	console.log(
		`| ${read === "als" ? "AsyncLocalStorage getStore()" : "module variable"} | ${median(samples).toFixed(2)} |`,
	);
}
await worker.dispose();
