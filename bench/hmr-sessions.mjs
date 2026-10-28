// The sessions hmr.mjs takes turns with: a Vite dev server for one design's page of 500 plain texts
// (dev-pages.mjs), in a directory of its own with its own optimizer cache, primed by a server and
// a page load before it, as a developer's dev server has its dependencies optimized already.
// - A page session opens the page in Chromium and checks every text it draws; then WARMUPS edits,
//   not counted, and EDITS timed: one message saved into its catalog with a text of its own, until
//   the page's MutationObserver saw the target's text change. After each edit every text is
//   checked again, the edit in place, and an error in the page fails the session. The page's
//   heap, once collected, is taken at load and after the edits.
// - The server render session runs grai's plugin with no page open: each edit timed until a server
//   render through Vite's module runner, polled each millisecond, shows it, and every text of the
//   page rendered and checked after it.
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

/** Throws unless the page drew `texts`, in order, and nothing failed in it. */
async function assertDrawn(tab, texts, faults, where) {
	if (faults.length > 0) throw new Error(`${where}: ${faults.join("; ")}`);
	const drawn = await tab.$$eval("#target, #list li", (elements) =>
		elements.map((element) => element.textContent),
	);
	const at = texts.findIndex((text, index) => drawn[index] !== text);
	if (at !== -1 || drawn.length !== texts.length)
		throw new Error(
			`${where}: the page drew ${drawn.length} texts of ${texts.length}; text ${at} is ${JSON.stringify(drawn[at])}, not ${JSON.stringify(texts[at])}`,
		);
}

/** A page of the server in a browser context of its own, its faults collected. */
async function opened(browser, server) {
	const context = await browser.newContext();
	const tab = await context.newPage();
	const faults = [];
	tab.on("pageerror", (error) => faults.push(String(error)));
	tab.on("console", (message) => {
		if (message.type() === "error") faults.push(message.text());
	});
	const start = performance.now();
	await tab.goto(server.resolvedUrls.local[0]);
	await tab.waitForFunction(() => window.ready, undefined, {
		timeout: PATIENCE_MS,
	});
	return { context, tab, faults, load: performance.now() - start };
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
 * A page session of `design` in round `round`, `timed` edits timed after the warm-up edits: its
 * load, heap and edits.
 */
export async function pageSession(browser, app, design, round, timed = EDITS) {
	const { locale, root, page, key, catalogFile } = fixture(app, design, round);
	try {
		const priming = await serve(app, root, design, locale, { edits: [] });
		await (await opened(browser, priming)).context.close();
		await priming.close();
		const timings = { edits: [] };
		const server = await serve(app, root, design, locale, timings);
		const { context, tab, faults, load } = await opened(browser, server);
		try {
			await assertDrawn(tab, page.texts, faults, `${design} at load`);
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
				const changed = await tab
					.waitForFunction(
						(text) => window.changed?.text === text && window.changed,
						text,
						{ timeout: PATIENCE_MS },
					)
					.then((handle) => handle.jsonValue());
				await assertDrawn(
					tab,
					page.texts.with(0, text),
					faults,
					`${design} after "${text}"`,
				);
				const reached = timings.edits.at(-1);
				if (edit >= WARMUPS)
					samples.push({
						total: changed.at - written,
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

/** The server render session of round `round`: grai's plugin's edits until a render shows them. */
export async function serverRenderSession(app, round) {
	const design = "grai's plugin";
	const { locale, root, page, key, catalogFile } = fixture(app, design, round);
	const server = await serve(app, root, design, locale, { edits: [] });
	try {
		const renderer = server.environments.ssr.runner;
		const rendered = async (key) =>
			(await renderer.import("/render.js")).render(key, locale);
		const assertRendered = async (texts, where) => {
			for (const [index, { key }] of page.calls.entries()) {
				const text = await rendered(key);
				if (text !== texts[index])
					throw new Error(
						`${where}: a server render shows ${JSON.stringify(text)} for ${key}, not ${JSON.stringify(texts[index])}`,
					);
			}
		};
		await assertRendered(page.texts, "at start");
		const original = JSON.parse(readFileSync(catalogFile, "utf8"))[key];
		const samples = [];
		for (let edit = 0; edit < WARMUPS + EDITS; edit++) {
			await delay(SAVE_INTERVAL_MS);
			const text = `Edit ${round}.${edit}: ${original}`;
			const written = save(catalogFile, key, text);
			const until = performance.now() + PATIENCE_MS;
			while ((await rendered(key)) !== text) {
				if (performance.now() > until)
					throw new Error(
						`no server render showed "${text}" in ${PATIENCE_MS} ms`,
					);
				await delay(1);
			}
			const shown = now() - written;
			await assertRendered(page.texts.with(0, text), `after "${text}"`);
			if (edit >= WARMUPS) samples.push({ server: shown });
		}
		return { samples };
	} finally {
		await server.close();
		rmSync(root, { recursive: true, force: true });
	}
}
