// Dev: one message edited until the page shows it, end to end in Vite: the catalog written, the
// watcher, the plugin, the socket, the browser, the DOM. "grai" is grai's own Vite plugin, as an
// app runs it, and it also times the edit until a server render through Vite's module runner
// shows it. The designs it was chosen from follow, as experiments: each serves the same module,
// every locale of every key in one table, from a compiler of this bench's own (prototype.mjs).
// "whole" lets Vite re-send and re-evaluate it on each edit; "patch" sends a custom HMR event
// naming a module of only the changed functions, which the page imports and writes into the
// table; "patch, fs.watch" does the same from its own watcher on the catalogs instead of Vite's.
// Beside them: Paraglide's own Vite plugin, which compiles again on an edit, and i18next and
// use-intl, whose page imports the locale's JSON and accepts its update. Each page's heap, once
// collected, is taken at load and after the edits, and against the same page with no messages
// grai's plugin has a budget for it (HEAP_BUDGET). Each design's dev server starts cold, in a new
// directory, and is timed from its creation until its page shows. The pages and their plugins are
// dev-pages.mjs's. The edits go to a copy of the catalogs under .cache, never the app's.
//   node hmr.mjs [app...]
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { cacheDir, selectedApps } from "./apps.mjs";
import { createServer, pluginsFor, writeFixture } from "./dev-pages.mjs";
import { otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";

const EDITS = 20;
const SAVE_INTERVAL_MS = 500;
/**
 * What grai's dev page may keep once collected, over the same page with no messages: bytes per
 * message, a key in one locale, at load, and bytes per edit after the edits. Its table holds every
 * locale of every key, and each call goes through a function a patch reaches: 351–361 B a message
 * on catalogs of 6,366 to 13,326 keys in three locales, and 5.2–5.8 KB more an edit.
 */
const HEAP_BUDGET = { message: 400, edit: 8 * 1024 };

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure(browser, app, design) {
	const locale = otherLocale(app);
	const root = join(cacheDir, "hmr", app.id);
	const key = writeFixture(root, app, locale, design);
	const timings = { edits: [] };
	// A cold start: the fixture's directory is new, with no output and no cache.
	const startAt = performance.now();
	const server = await createServer({
		root,
		configFile: false,
		logLevel: "silent",
		// A port the system picks, so that runs side by side never meet.
		server: {
			host: "127.0.0.1",
			port: 0,
			watch: { ignored: ["**/render.js", "**/main.js", "**/index.html"] },
		},
		plugins: pluginsFor(design, app, root, locale, timings),
	});
	await server.listen();
	const page = await browser.newPage();
	page.on("pageerror", (error) => console.error("page error:", error.message));
	const loadStart = performance.now();
	await page.goto(server.resolvedUrls.local[0]);
	await page.waitForFunction(() => window.ready);
	const load = performance.now() - loadStart;
	const startToPage = performance.now() - startAt;
	// What the page keeps, its messages among it: V8's heap once a full collection has run.
	const cdp = await page.context().newCDPSession(page);
	const retained = async () => {
		await cdp.send("HeapProfiler.collectGarbage");
		return (await cdp.send("Runtime.getHeapUsage")).usedSize;
	};
	const heap = { load: await retained() };

	const catalogFile = join(root, "messages", `${locale}.json`);
	const catalogBytes = readFileSync(catalogFile).length;
	// grai's: when a server render through Vite's runner shows the edit, polled each millisecond,
	// for as long as the page is waited for.
	const ssr = server.environments.ssr;
	const rendered = async (text) => {
		const until = performance.now() + 120_000;
		for (;;) {
			const { render } = await ssr.runner.import("/render.js");
			const shown = render(key, locale);
			if (shown === text) return performance.timeOrigin + performance.now();
			if (performance.now() > until)
				throw new Error(
					`a server render still showed ${JSON.stringify(shown)} 120 s after the edit to ${JSON.stringify(text)}`,
				);
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
	};
	const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
	const original = catalog[key];
	// The server's program evaluated before the first edit, as a dev server has it, so the first edit
	// times a patch, not the program's first evaluation.
	if (design === "grai's plugin") await rendered(original);
	const latencies = [];
	const edits = design === "no messages" ? 0 : EDITS + 3;
	for (let edit = 0; edit < edits; edit++) {
		// Saves come seconds apart; back-to-back writes would measure the file watcher's coalescing.
		await new Promise((resolve) => setTimeout(resolve, SAVE_INTERVAL_MS));
		catalog[key] = `Edit ${edit}: ${original}`;
		const written = performance.timeOrigin + performance.now();
		writeFileSync(catalogFile, JSON.stringify(catalog, null, "\t"));
		const [changed, serverAt] = await Promise.all([
			page
				.waitForFunction(
					(text) => window.changed?.text === text && window.changed,
					catalog[key],
					{ timeout: 120_000 },
				)
				.then((handle) => handle.jsonValue()),
			design === "grai's plugin" ? rendered(catalog[key]) : undefined,
		]);
		const reached = timings.edits.at(-1);
		if (edit >= 3)
			latencies.push({
				total: changed.at - written,
				server: serverAt === undefined ? undefined : serverAt - written,
				watcher: reached && reached.reached - written,
				plugin: reached && reached.answered - reached.reached,
				browser: reached && changed.at - reached.answered,
			});
	}
	heap.edits = await retained();
	await page.close();
	await server.close();
	rmSync(root, { recursive: true, force: true });
	const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	const served =
		design === "no messages"
			? "—"
			: timings.generate
				? `${megabytes(timings.generate.bytes)}, ${timings.generate.ms.toFixed(0)} ms`
				: `${megabytes(catalogBytes)} catalog`;
	const cell = (field) =>
		latencies[0]?.[field] === undefined
			? "—"
			: median(latencies.map((latency) => latency[field])).toFixed(1);
	const ms = (field) =>
		latencies[0]?.[field] === undefined
			? undefined
			: median(latencies.map((latency) => latency[field]));
	return {
		design,
		heap,
		measured: {
			design,
			startToPage,
			pageLoad: load,
			editToPage: ms("total"),
			editToServer: ms("server"),
			heap,
		},
		row: `| ${design} | ${served} | ${load.toFixed(0)} | ${cell("total")} | ${cell("server")} | ${cell("watcher")} | ${cell("plugin")} | ${cell("browser")} | ${megabytes(heap.load)} | ${megabytes(heap.edits)} |`,
	};
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	const designs = [
		"grai's plugin",
		"whole",
		"patch",
		"patch, fs.watch",
		"paraglide",
		"i18next",
		"use-intl",
		"no messages",
	];
	// Paraglide's plugin logs each compile, so the table is printed once every design has run.
	const results = [];
	for (const design of designs)
		results.push(await measure(browser, app, design));
	console.log(
		`\n### ${app.name}: one message edited until the page shows it, Vite dev, Chromium ${browser.version()}, median of ${EDITS} edits, ms; the page's heap once collected\n`,
	);
	console.log(
		"| design | dev module, generated in | page load | edit to page | edit to server render | watcher | plugin | browser | heap at load | heap after the edits |",
	);
	console.log("|---|---|---|---|---|---|---|---|---|---|");
	for (const { row } of results) console.log(row);
	recordResults(
		`hmr-${app.id}`,
		results.map(({ measured }) => measured),
		{ app: app.name, edits: EDITS, chromium: browser.version() },
	);
	const heapOf = (design) =>
		results.find((result) => result.design === design).heap;
	const grai = heapOf("grai's plugin");
	const none = heapOf("no messages");
	const messages =
		app.locales.length * Object.keys(app.messages[app.baseLocale]).length;
	const perMessage = (grai.load - none.load) / messages;
	const perEdit = (grai.edits - grai.load) / (EDITS + 3);
	const over = perMessage > HEAP_BUDGET.message || perEdit > HEAP_BUDGET.edit;
	console.log(
		`\ngrai's plugin keeps ${perMessage.toFixed(0)} B a message over the page with no messages (budget ${HEAP_BUDGET.message} B), and ${(perEdit / 1024).toFixed(1)} KB more an edit (budget ${HEAP_BUDGET.edit / 1024} KB)${over ? ": over budget" : ""}`,
	);
	if (over) process.exitCode = 1;
}
await browser.close();
