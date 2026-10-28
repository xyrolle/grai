// The sessions hmr.mjs takes turns with: a Vite dev server for one design's page of 500 plain texts
// (dev-pages.mjs), in a directory of its own with its own optimizer cache, primed by a server and
// a page load before it, as a developer's dev server has its dependencies optimized already.
// - A page session opens the page in Chromium; then WARMUPS edits, not counted, and EDITS timed:
//   one message saved into its catalog with a text of its own, until the page's MutationObserver
//   saw the target's text change. The page's heap, once collected, is taken at load and after the
//   edits.
//   On grai's plugin, each edit is also timed until a server render through Vite's module runner,
//   polled each millisecond, shows it.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cacheDir } from "./apps.mjs";
import {
	createServer,
	pluginsFor,
	textPage,
	writeFixture,
} from "./dev-pages.mjs";
import { otherLocale } from "./request.mjs";

export const WARMUPS = 3;
export const EDITS = 5;
/** Saves come this far apart, so that a file watcher never takes two as one. */
const SAVE_INTERVAL_MS = 500;
const PATIENCE_MS = 120_000;
const now = () => performance.timeOrigin + performance.now();

/**
 * A design's dev server in `root`, its optimizer cache beside the page, listening on a port the
 * system picks.
 */
async function serve(app, root, design, locale, timings) {
	const server = await createServer({
		root,
		cacheDir: join(root, ".vite"),
		configFile: false,
		logLevel: "silent",
		server: {
			host: "127.0.0.1",
			port: 0,
			watch: { ignored: ["**/render.js", "**/main.js", "**/index.html"] },
		},
		plugins: pluginsFor(design, app, root, locale, timings),
	});
	await server.listen();
	return server;
}

/** A page of the server in a browser context of its own. */
async function opened(browser, server) {
	const context = await browser.newContext();
	const tab = await context.newPage();
	tab.on("pageerror", (error) => console.error("page error:", error.message));
	const start = performance.now();
	await tab.goto(server.resolvedUrls.local[0]);
	await tab.waitForFunction(() => window.ready, undefined, {
		timeout: PATIENCE_MS,
	});
	return { context, tab, load: performance.now() - start };
}

/** The session's directory, its page written for the design: the page and its edited key. */
function fixture(app, design, round) {
	const locale = otherLocale(app);
	const name = `${round}-${design.replace(/\W+/g, "-")}`;
	const root = join(cacheDir, "hmr", app.id, name);
	const page = textPage(app, locale);
	const key = writeFixture(root, app, locale, design, page);
	const catalogFile = join(root, "messages", `${locale}.json`);
	return { locale, root, page, key, catalogFile };
}

/** Saves the key's text into the catalog; returns when. */
function save(catalogFile, key, text) {
	const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
	catalog[key] = text;
	const written = now();
	writeFileSync(catalogFile, JSON.stringify(catalog, null, "\t"));
	return written;
}

/**
 * For grai's plugin: once its server's program is evaluated, as a dev server has it before an edit,
 * a function that resolves when a server render shows `text` for the key, polled each millisecond.
 */
async function serverRendering(server, locale, key) {
	const renderer = server.environments.ssr.runner;
	const rendered = async () =>
		(await renderer.import("/render.js")).render(key, locale);
	await rendered();
	return async (text) => {
		const until = performance.now() + PATIENCE_MS;
		while ((await rendered()) !== text) {
			if (performance.now() > until)
				throw new Error(
					`no server render showed "${text}" in ${PATIENCE_MS} ms`,
				);
			await delay(1);
		}
		return now();
	};
}

/**
 * A page session of `design` in round `round`, `timed` edits timed after the warm-up edits: its
 * load, heap and edits.
 */
export async function pageSession(browser, app, design, round, timed = EDITS) {
	const { locale, root, key, catalogFile } = fixture(app, design, round);
	try {
		const priming = await serve(app, root, design, locale, { edits: [] });
		await (await opened(browser, priming)).context.close();
		await priming.close();
		const timings = { edits: [] };
		const server = await serve(app, root, design, locale, timings);
		const { context, tab, load } = await opened(browser, server);
		try {
			const untilRendered =
				design === "grai's plugin"
					? await serverRendering(server, locale, key)
					: undefined;
			const cdp = await context.newCDPSession(tab);
			const retained = async () => {
				await cdp.send("HeapProfiler.collectGarbage");
				return (await cdp.send("Runtime.getHeapUsage")).usedSize;
			};
			const heap = { load: await retained() };
			const original = JSON.parse(readFileSync(catalogFile, "utf8"))[key];
			const samples = [];
			const edits = design === "no messages" ? 0 : WARMUPS + timed;
			for (let edit = 0; edit < edits; edit++) {
				await delay(SAVE_INTERVAL_MS);
				const text = `Edit ${round}.${edit}: ${original}`;
				const written = save(catalogFile, key, text);
				const [changed, serverAt] = await Promise.all([
					tab
						.waitForFunction(
							(text) => window.changed?.text === text && window.changed,
							text,
							{ timeout: PATIENCE_MS },
						)
						.then((handle) => handle.jsonValue()),
					untilRendered?.(text),
				]);
				const reached = timings.edits.at(-1);
				if (edit >= WARMUPS)
					samples.push({
						total: changed.at - written,
						server: serverAt === undefined ? undefined : serverAt - written,
						watcher: reached && reached.reached - written,
						plugin: reached && reached.answered - reached.reached,
						browser: reached && changed.at - reached.answered,
					});
			}
			heap.edits = await retained();
			return { load, heap, samples, generate: timings.generate };
		} finally {
			await context.close();
			await server.close();
		}
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}
