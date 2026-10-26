// What the server pays for the bound locale (middleware-timings.mjs): per request, what grai's
// middleware and Paraglide's add to a handler alone; per message call, inside the middleware and
// outside it naming its locale. In Node, and inside a local workerd started by Wrangler's test
// harness, at Workers' default Node.js compatibility: Paraglide's middleware imports `async_hooks`
// without the `node:` prefix, which the `nodejs_als` flag alone does not resolve.
//   node middleware.mjs
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile as compileParaglide } from "@inlang/paraglide-js";
import { createTestHarness } from "wrangler";
import { cacheDir } from "./apps.mjs";
import { graiSource } from "./grai.mjs";
import { formatNs } from "./measure.mjs";
import { writeProject } from "./paraglide.mjs";

const catalogs = new URL("../examples/workers/messages/", import.meta.url)
	.pathname;
const locales = ["en", "ro", "ar"];
const baseLocale = "en";
const { compile } = await import(join(graiSource, "index.ts"));

/** An empty .cache/middleware/<name>. */
function projectDirectory(name) {
	const directory = join(cacheDir, "middleware", name);
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(directory, { recursive: true });
	return directory;
}

/** Compiles the Workers example's catalogs into .cache/middleware/<name>, by `strategy`. */
async function compileProject(name, strategy) {
	const directory = projectDirectory(name);
	cpSync(catalogs, join(directory, "messages"), { recursive: true });
	const config = join(directory, "grai.config.json");
	writeFileSync(
		config,
		JSON.stringify({
			locales,
			baseLocale,
			catalogs: "messages/{locale}.json",
			outdir: "out",
			strategy,
			...(strategy.includes("cookie") ? { cookieName: "lang" } : {}),
		}),
	);
	const { errors } = await compile(config);
	if (errors.length > 0) throw new Error(errors.map(String).join("\n"));
}

/** The same catalogs compiled by Paraglide into .cache/middleware/paraglide-<name>. */
async function compileParaglideProject(name, strategy) {
	const directory = projectDirectory(`paraglide-${name}`);
	const app = {
		locales,
		baseLocale,
		catalogs: { [baseLocale]: join(catalogs, `${baseLocale}.json`) },
	};
	await compileParaglide({
		project: writeProject(app, directory),
		outdir: join(directory, "out"),
		strategy: [...strategy, "baseLocale"],
		cookieName: "lang",
		emitGitIgnore: false,
		emitPrettierIgnore: false,
		emitReadme: false,
	});
}

for (const [name, strategy] of [
	["headers", ["cookie", "preferredLanguage"]],
	["url", ["url"]],
]) {
	await compileProject(name, strategy);
	await compileParaglideProject(name, strategy);
}

const { timeServer } = await import("./middleware-timings.mjs");
const node = await timeServer();
const server = createTestHarness({
	workers: [
		{
			config: {
				name: "grai-bench-middleware",
				main: new URL("middleware-worker.js", import.meta.url).pathname,
				compatibility_date: "2026-10-01",
			},
		},
	],
});
await server.listen();
const workerd = await (await server.fetch("/")).json();
await server.close();
const runtimes = [
	["Node", node],
	["workerd", workerd],
];

console.log(
	"\n### a request: the handler alone, and what each middleware adds to it, ns\n",
);
console.log("| request | runtime | handler alone | grai | Paraglide |");
console.log("|---|---|---|---|---|");
for (const [runtime, { requests }] of runtimes)
	for (const { name, alone, grai, paraglide } of requests)
		console.log(
			`| ${name} | ${runtime} | ${formatNs(alone)} | ${formatNs(grai)} | ${formatNs(paraglide)} |`,
		);

console.log(
	"\n### a message call, inside a request and outside one naming its locale, ns\n",
);
console.log(
	"| runtime | text, inside | text, naming its locale | with inputs, inside | with inputs, naming its locale |",
);
console.log("|---|---|---|---|---|");
for (const [runtime, { calls }] of runtimes)
	console.log(
		`| ${runtime} | ${formatNs(calls.inside.text)} | ${formatNs(calls.named.text)} | ${formatNs(calls.inside.inputs)} | ${formatNs(calls.named.inputs)} |`,
	);
