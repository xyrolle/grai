// Dev start: a Vite dev server started cold, until its page of 500 messages shows, per library
// (dev-pages.mjs): grai's plugin, Paraglide's, i18next's and use-intl's pages, and the page with no
// messages, which draws the same texts from its own code. Two pages: 500 plain texts, and 500
// calls in the catalog's own mix of texts, inputs, plurals and markup.
//
// Each start is a new Node process, in a new directory with no output and no cache, Vite's own
// among them. It is timed from the server's creation, once Vite, the plugins and Chromium have
// loaded, by the page's clock: until its texts are in the DOM ("ready"), and until the frame
// drawn after that ("shown"). Importing the plugins and writing the page are outside the time.
// Once timed, the page's texts are checked against the texts its calls show, and an error in the
// page fails the start.
//
// Every library starts once a round, in an order that rotates, the rounds a multiple of their
// number so that each takes every place in the order alike. Each round is kept with the load it
// started at; medians of the rounds, with a 95% interval, and each library's difference from
// grai's plugin in the same round, so that load shared by a round cancels out.
//   ROUNDS=10 node dev-start.mjs [app...]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { cacheDir, selectedApps } from "./apps.mjs";
import {
	createServer,
	mixedPage,
	pluginsFor,
	textPage,
	writeFixture,
} from "./dev-pages.mjs";
import { median, medianInterval } from "./medians.mjs";
import { otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";
import { startServer, stopServer } from "./servers.mjs";

const designs = [
	"grai's plugin",
	"paraglide",
	"i18next",
	"use-intl",
	"no messages",
];
const ROUNDS = Number(process.env.ROUNDS ?? 10);
/** How long one start may take, Paraglide's compile of 13,326 keys included. */
const PATIENCE_MS = 120_000;
const self = new URL(import.meta.url).pathname;

/** The time on this machine's clock, which the page's clock shares. */
const now = () => performance.timeOrigin + performance.now();

/** What is wrong with the page: an error in it, or the first text it drew other than expected. */
function fault(drawn, texts, errors) {
	if (errors.length > 0) return `the page failed: ${errors.join("; ")}`;
	if (drawn.length !== texts.length)
		return `the page drew ${drawn.length} texts of ${texts.length}`;
	const at = drawn.findIndex((text, index) => text !== texts[index]);
	if (at === -1) return undefined;
	return `text ${at} is ${JSON.stringify(drawn[at])}, not ${JSON.stringify(texts[at])}`;
}

/** Runs in the child: one cold start of the design's page, printed as JSON. */
async function child(design, name, pageFile) {
	const [app] = selectedApps([name]);
	const locale = otherLocale(app);
	const page = JSON.parse(readFileSync(pageFile, "utf8"));
	const root = join(cacheDir, "dev-start", app.id);
	writeFixture(root, app, locale, design, page);
	const viteCache = join(root, ".vite");
	if (existsSync(viteCache))
		throw new Error(`Vite's cache ${viteCache} is there before the start`);
	const browser = await chromium.launch();
	try {
		const tab = await browser.newPage();
		const errors = [];
		tab.on("pageerror", (error) => errors.push(error.message));
		tab.on("console", (message) => {
			if (message.type() === "error") errors.push(message.text());
		});
		const start = now();
		const server = await createServer({
			root,
			cacheDir: viteCache,
			configFile: false,
			logLevel: "silent",
			server: { host: "127.0.0.1", port: 0 },
			plugins: pluginsFor(design, app, root, locale, { edits: [] }),
		});
		try {
			await server.listen();
			const listening = now() - start;
			await tab.goto(server.resolvedUrls.local[0]);
			const shown = await tab
				.waitForFunction(() => window.shown, undefined, {
					timeout: PATIENCE_MS,
				})
				.then((handle) => handle.jsonValue());
			const drawn = await tab.$$eval("#target, #list li", (elements) =>
				elements.map((element) => element.textContent),
			);
			const problem = fault(drawn, page.texts, errors);
			if (problem !== undefined) throw new Error(`${design}: ${problem}`);
			console.log(
				JSON.stringify({
					listening,
					ready: shown.ready - start,
					shown: shown.painted - start,
					chromium: browser.version(),
				}),
			);
		} finally {
			await server.close();
		}
	} finally {
		await browser.close();
	}
}

/** One cold start in a new process, in a process group of its own, stopped however it ends. */
async function start(design, app, pageFile) {
	const starting = startServer(
		process.execPath,
		[self, "--child", design, app.id, pageFile],
		{ stdio: ["ignore", "pipe", "inherit"] },
	);
	let output = "";
	starting.stdout.setEncoding("utf8").on("data", (chunk) => {
		output += chunk;
	});
	let timer;
	const exit = await Promise.race([
		new Promise((resolve) => starting.once("close", resolve)),
		new Promise((resolve) => {
			timer = setTimeout(() => resolve("timeout"), PATIENCE_MS);
		}),
	]);
	clearTimeout(timer);
	await stopServer(starting);
	if (exit === "timeout")
		throw new Error(`${design}'s start took over ${PATIENCE_MS} ms`);
	if (exit !== 0) throw new Error(`${design}'s start exited with ${exit}`);
	// Its result is its one line of JSON; Paraglide's plugin logs its compiles around it.
	return JSON.parse(
		output.split("\n").findLast((line) => line.startsWith("{")),
	);
}

/** Every design's starts on one page, round by round, each round with the load it started at. */
async function rounds(app, page) {
	const directory = join(cacheDir, "dev-start");
	mkdirSync(directory, { recursive: true });
	const pageFile = join(directory, `${app.id}.${page.name}.json`);
	writeFileSync(pageFile, JSON.stringify(page));
	const kept = [];
	for (let round = 0; round < ROUNDS; round++) {
		const load = loadavg()[0];
		const starts = {};
		for (let index = 0; index < designs.length; index++) {
			const design = designs[(index + round) % designs.length];
			starts[design] = await start(design, app, pageFile);
		}
		kept.push({ load, starts });
	}
	return kept;
}

const whole = (ms) => ms.toFixed(0);
const signed = (ms) => `${ms > 0 ? "+" : ""}${whole(ms)}`;
const between = ({ low, high }, write = whole) =>
	`${write(low)} to ${write(high)}`;
const percent = ({ confidence }) => `${(confidence * 100).toFixed(1)}%`;

/** Prints and records one page's rounds: each design's medians, and its difference from grai's. */
function report(app, page, kept) {
	const runs = (design, field) =>
		kept.map(({ starts }) => starts[design][field]);
	const loads = kept.map(({ load }) => load);
	const [grai, ...others] = designs;
	console.log(
		`\n### ${app.name}, ${page.title}: a cold Vite dev server until its page shows, each start a new process, ${ROUNDS} rounds at a load of ${loads.map(whole).join(", ")}, ms\n`,
	);
	const confidence = percent(medianInterval(runs(grai, "shown")));
	console.log(
		`| design | shown, median | ${confidence} interval | range | ready, median | listening, median |\n|---|---|---|---|---|---|`,
	);
	const rows = designs.map((design) => {
		const shown = runs(design, "shown");
		const range = { low: Math.min(...shown), high: Math.max(...shown) };
		console.log(
			`| ${design} | ${whole(median(shown))} | ${between(medianInterval(shown))} | ${between(range)} | ${whole(median(runs(design, "ready")))} | ${whole(median(runs(design, "listening")))} |`,
		);
		return {
			design,
			ms: median(shown),
			runs: shown,
			ready: runs(design, "ready"),
			listening: runs(design, "listening"),
		};
	});
	console.log(
		`\n${grai} minus each, in the same round, ms:\n\n| against | median difference | ${confidence} interval | rounds ${grai} is faster |\n|---|---|---|---|`,
	);
	const differences = others.map((design) => {
		const each = kept.map(
			({ starts }) => starts[grai].shown - starts[design].shown,
		);
		const faster = each.filter((difference) => difference < 0).length;
		console.log(
			`| ${design} | ${signed(median(each))} | ${between(medianInterval(each), signed)} | ${faster} of ${each.length} |`,
		);
		return { against: design, ms: median(each), runs: each };
	});
	recordResults(
		page.name === "text"
			? `dev-start-${app.id}`
			: `dev-start-${page.name}-${app.id}`,
		rows,
		{
			app: app.name,
			page: page.title,
			rounds: ROUNDS,
			loads,
			differences,
			chromium: kept[0].starts[grai].chromium,
		},
	);
}

if (process.argv[2] === "--child") {
	await child(process.argv[3], process.argv[4], process.argv[5]);
} else {
	if (ROUNDS % designs.length !== 0)
		throw new Error(
			`ROUNDS is ${ROUNDS}: a multiple of ${designs.length} gives every library each place in the order alike.`,
		);
	for (const app of selectedApps()) {
		const locale = otherLocale(app);
		const pages = [
			{ name: "text", title: "500 plain texts", ...textPage(app, locale) },
			{
				name: "mixed",
				title: "500 calls in the catalog's own mix",
				...(await mixedPage(app, locale)),
			},
		];
		for (const page of pages) report(app, page, await rounds(app, page));
	}
}
