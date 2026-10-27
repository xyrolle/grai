// Dev start: a Vite dev server started cold, until its page of 500 messages shows, per library
// (dev-pages.mjs): grai's plugin, Paraglide's, i18next's and use-intl's pages, and the page with no
// messages, which draws the same texts from its own code.
//
// Each start is a new Node process, in a new directory with no output and no cache, Vite's own
// among them. It is timed from the server's creation, once Vite, the plugins and Chromium have
// loaded, by the page's clock: until its texts are in the DOM ("ready"), and until the frame
// drawn after that ("shown"). Importing the plugins and writing the page are outside the time.
// Once timed, the page's texts are checked against the texts its calls show, and an error in the
// page fails the start.
//
// Every library starts once a round, in an order that rotates, so the load from other work weighs
// on each alike; medians of ROUNDS, with every round kept.
//   node dev-start.mjs [app...]
import { existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { cacheDir, selectedApps } from "./apps.mjs";
import {
	createServer,
	pluginsFor,
	textPage,
	writeFixture,
} from "./dev-pages.mjs";
import { otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";
import { startServer, stopServer } from "./servers.mjs";

const ROUNDS = 7;
const designs = [
	"grai's plugin",
	"paraglide",
	"i18next",
	"use-intl",
	"no messages",
];
/** How long one start may take, Paraglide's compile of 13,326 keys among it. */
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
async function child(design, name) {
	const [app] = selectedApps([name]);
	const locale = otherLocale(app);
	const page = textPage(app, locale);
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
async function start(design, app) {
	const starting = startServer(
		process.execPath,
		[self, "--child", design, app.id],
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

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (process.argv[2] === "--child") {
	await child(process.argv[3], process.argv[4]);
} else {
	for (const app of selectedApps()) {
		const runs = Object.fromEntries(designs.map((design) => [design, []]));
		let chromiumVersion;
		for (let round = 0; round < ROUNDS; round++) {
			for (let index = 0; index < designs.length; index++) {
				const design = designs[(index + round) % designs.length];
				const result = await start(design, app);
				chromiumVersion = result.chromium;
				runs[design].push(result);
			}
		}
		console.log(
			`\n### ${app.name}: a cold Vite dev server until its page of messages shows, each start a new process, medians of ${ROUNDS}, ms\n`,
		);
		console.log(
			"| design | shown, median | range | ready, median | listening, median |\n|---|---|---|---|---|",
		);
		const rows = designs.map((design) => {
			const field = (name) => runs[design].map((result) => result[name]);
			const shown = field("shown");
			const ms = median(shown);
			const low = Math.min(...shown);
			const high = Math.max(...shown);
			console.log(
				`| ${design} | ${ms.toFixed(0)} | ${low.toFixed(0)}–${high.toFixed(0)} | ${median(field("ready")).toFixed(0)} | ${median(field("listening")).toFixed(0)} |`,
			);
			return {
				design,
				ms,
				runs: shown,
				ready: field("ready"),
				listening: field("listening"),
			};
		});
		recordResults(`dev-start-${app.id}`, rows, {
			app: app.name,
			rounds: ROUNDS,
			chromium: chromiumVersion,
		});
	}
}
