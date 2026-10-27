// Server pages: what a server pays to load its pages' messages as grai's Vite plugin lays them
// out. Every key of the catalog is spread over 64 pages, as a real app's are: most keys on one
// page, the rest on 2 to 16. Each page renders every key it names, through `m`. The pages are built
// for a server, and each measurement is a new Node process, then a new workerd
// (server-pages-worker.js), that imports the built output as it is, a module per chunk: one page,
// then every page, then renders each page once. Medians of nine.
//   node server-pages.mjs [app...]
import { execFileSync } from "node:child_process";
import { copyFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { selectedApps } from "./apps.mjs";
import { sampleCalls } from "./calls.mjs";
import { graiEntry, writeGraiProject } from "./grai.mjs";
import { inWorkerd } from "./startup-workerd.mjs";

const PAGES = 64;
const RUNS = 9;
const here = new URL(".", import.meta.url).pathname;
/** The worker that times the same in workerd, copied beside the built pages. */
const worker = "server-pages-worker.js";

/** A seeded random number in [0, 1), so every run and every tree builds the same pages. */
function random(seed) {
	let state = seed;
	return () => {
		state = (Math.imul(state, 1103515245) + 12345) >>> 0;
		return state / 2 ** 32;
	};
}

/** Every key's call, on the pages that name it: six in ten on one page, the rest on 2 to 16. */
function pagesOf(calls) {
	const next = random(7);
	const pages = Array.from({ length: PAGES }, () => []);
	for (const call of calls) {
		const uses = next() < 0.6 ? 1 : 2 + Math.floor(next() * 15);
		const chosen = new Set();
		while (chosen.size < uses) chosen.add(Math.floor(next() * PAGES));
		for (const page of chosen) pages[page].push(call);
	}
	return pages;
}

/** A page's module: a render that calls each of its keys through `m`. */
function pageModule(calls) {
	const lines = calls.map(
		({ key, kind, inputs }) =>
			`\ts += m.${key}(${kind === "text" ? "" : JSON.stringify(inputs)});`,
	);
	return `import { m } from "./out/messages.js";\nexport function render() {\n\tlet s = "";\n${lines.join("\n")}\n\treturn s;\n}\n`;
}

/** Builds the pages for a server with grai's Vite plugin: the output directory and its pages. */
async function builtPages(app) {
	const config = writeGraiProject(app, "server-pages");
	const root = dirname(config);
	const calls = sampleCalls(
		app,
		Object.keys(app.messages[app.baseLocale]).length,
	);
	const input = {};
	pagesOf([...new Map(calls.map((call) => [call.key, call])).values()]).forEach(
		(page, index) => {
			const file = join(root, `page${index}.js`);
			writeFileSync(file, pageModule(page));
			input[`page${index}`] = file;
		},
	);
	const { grai } = await import(graiEntry("./vite"));
	const outDir = join(root, "server");
	rmSync(outDir, { recursive: true, force: true });
	await build({
		root,
		configFile: false,
		logLevel: "silent",
		plugins: [grai({ config })],
		build: { ssr: true, outDir, rolldownOptions: { input } },
	});
	return { outDir, pages: Object.keys(input).map((name) => `${name}.js`) };
}

/** Runs in the child: imports one page, then the others, then renders each once; the times. */
async function child(outDir, ...pages) {
	const url = (page) => pathToFileURL(join(outDir, page)).href;
	const start = performance.now();
	const first = await import(url(pages[0]));
	const one = performance.now();
	const rest = await Promise.all(
		pages.slice(1).map((page) => import(url(page))),
	);
	const every = performance.now();
	let length = 0;
	for (const page of [first, ...rest]) length += page.render().length;
	const rendered = performance.now();
	console.log(
		JSON.stringify({
			one: one - start,
			every: every - start,
			render: rendered - every,
			length,
		}),
	);
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** The median of each time over some runs, to `digits` decimals. */
const times = (runs, digits) =>
	["one", "every", "render"].map(
		(field) => `${median(runs.map((run) => run[field])).toFixed(digits)} ms`,
	);

/** The runs in new Node processes, then in new workerds, each importing the built output as it is. */
async function benchApp(app) {
	const { outDir, pages } = await builtPages(app);
	const modules = readdirSync(outDir, { recursive: true }).filter((file) =>
		String(file).endsWith(".js"),
	).length;
	const self = new URL(import.meta.url).pathname;
	const node = Array.from({ length: RUNS }, () =>
		JSON.parse(
			execFileSync(process.execPath, [self, "--child", outDir, ...pages], {
				encoding: "utf8",
			}),
		),
	);
	copyFileSync(join(here, worker), join(outDir, worker));
	writeFileSync(
		join(outDir, "pages.js"),
		`export const pages = ${JSON.stringify(pages)};\n`,
	);
	const workerd = [];
	for (let run = 0; run < RUNS; run++)
		workerd.push(await inWorkerd(outDir, worker));
	console.log(
		`| ${app.name}, Node | ${modules} | ${times(node, 1).join(" | ")} |`,
	);
	console.log(
		`| ${app.name}, workerd | ${modules} | ${times(workerd, 0).join(" | ")} |`,
	);
}

if (process.argv[2] === "--child") await child(...process.argv.slice(3));
else {
	console.log(
		`\n### ${PAGES} pages built for a server, a new Node ${process.versions.node} process or a new workerd (to the millisecond its timer gives), median of ${RUNS}\n`,
	);
	console.log(
		"| catalog | modules in the build | load one page | load every page | render each once |",
	);
	console.log("|---|---|---|---|---|");
	for (const app of selectedApps()) await benchApp(app);
}
