// Dev start: a Vite dev server started cold, until its page of 500 messages shows, per library
// (dev-pages.mjs): grai's plugin, Paraglide's, i18next's and use-intl's pages, and the page with no
// messages. Each start is a new Node process, in a new directory with no output and no cache,
// timed from the server's creation, once Vite, the plugins and Chromium have loaded, until the
// page shows its messages. Every library starts once a round, in an order that rotates, so the
// load from other work weighs on each alike; medians of ROUNDS, with every round kept.
//   node dev-start.mjs [app...]
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { cacheDir, selectedApps } from "./apps.mjs";
import { createServer, pluginsFor, writeFixture } from "./dev-pages.mjs";
import { otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";

const ROUNDS = 7;
const designs = [
	"grai's plugin",
	"paraglide",
	"i18next",
	"use-intl",
	"no messages",
];
const self = new URL(import.meta.url).pathname;

/** Runs in the child: one cold start of the design's page, printed as JSON. */
async function child(design, name) {
	const [app] = selectedApps([name]);
	const locale = otherLocale(app);
	const root = join(cacheDir, "dev-start", app.id);
	writeFixture(root, app, locale, design);
	const browser = await chromium.launch();
	const page = await browser.newPage();
	const start = performance.now();
	const server = await createServer({
		root,
		configFile: false,
		logLevel: "silent",
		server: { host: "127.0.0.1", port: 0 },
		plugins: pluginsFor(design, app, root, locale, { edits: [] }),
	});
	await server.listen();
	await page.goto(server.resolvedUrls.local[0]);
	await page.waitForFunction(() => window.ready);
	const ms = performance.now() - start;
	const version = browser.version();
	await server.close();
	await browser.close();
	console.log(JSON.stringify({ ms, chromium: version }));
}

/** One cold start in a new process, its result. */
function start(design, app) {
	const output = execFileSync(
		process.execPath,
		[self, "--child", design, app.id],
		{ encoding: "utf8" },
	);
	return JSON.parse(output.trim().split("\n").at(-1));
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
				const result = start(design, app);
				chromiumVersion = result.chromium;
				runs[design].push(result.ms);
			}
		}
		console.log(
			`\n### ${app.name}: a cold Vite dev server until its page of messages shows, each start a new process, medians of ${ROUNDS}, ms\n`,
		);
		console.log("| design | median | range |\n|---|---|---|");
		const rows = designs.map((design) => {
			const ms = median(runs[design]);
			const low = Math.min(...runs[design]);
			const high = Math.max(...runs[design]);
			console.log(
				`| ${design} | ${ms.toFixed(0)} | ${low.toFixed(0)}–${high.toFixed(0)} |`,
			);
			return { design, ms, runs: runs[design] };
		});
		recordResults(`dev-start-${app.id}`, rows, {
			app: app.name,
			rounds: ROUNDS,
			chromium: chromiumVersion,
		});
	}
}
