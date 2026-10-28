// Dev: one message edited until the page shows it, end to end in Vite: the catalog written, the
// watcher, the plugin, the socket, the browser, the DOM (hmr-sessions.mjs).
// "grai's plugin" is grai's own Vite plugin, as an app runs it. The designs it was chosen from
// follow, as experiments: each serves the same module, every locale of every key in one table,
// from a compiler of this bench's own (prototype.mjs). "whole" lets Vite re-send and re-evaluate it
// on each edit; "patch" sends a custom HMR event naming a module of only the changed functions,
// which the page imports and writes into the table; "patch, fs.watch" does the same from its own
// watcher on the catalogs instead of Vite's. Beside them: Paraglide's own Vite plugin, which
// compiles again on an edit, and i18next and use-intl, whose page imports the locale's JSON and
// accepts its update. grai's plugin's edits until a server render shows them are a session of their
// own, with no page open. Each design's session takes its turn once a round, in an order that
// rotates (rounds.mjs), every sample kept with its round's load, and each design's edits paired
// with grai's plugin's of the same round. Each page's heap, once collected, is taken at load and
// after the edits. Against the same page with no messages, grai's plugin has a budget for it
// (HEAP_BUDGET), its heap per edit taken in a session of its own after the rounds. The pages and
// their plugins are dev-pages.mjs's; the edits go to a copy of the catalogs under .cache, never the
// app's.
//   node hmr.mjs [app...]      ROUNDS=<multiple of 9> to change the rounds
import { chromium } from "playwright-core";
import { selectedApps } from "./apps.mjs";
import {
	EDITS,
	pageSession,
	serverRenderSession,
	WARMUPS,
} from "./hmr-sessions.mjs";
import { median, medianInterval } from "./medians.mjs";
import { recordResults } from "./results.mjs";
import {
	inRounds,
	pairedRatio,
	ratioText,
	roundCount,
	roundsRecord,
} from "./rounds.mjs";

/**
 * What grai's dev page may keep once collected, over the same page with no messages: bytes per
 * message, a key in one locale, at load, and bytes per edit after WARMUPS and HEAP_EDITS edits, in
 * a session of its own. Each call goes through a function a patch reaches: 226 B a message on the
 * synthetic catalog of 6,366 keys in three locales, its page holding its own locale's words alone,
 * and 5.2–7.2 KB more an edit.
 */
const HEAP_BUDGET = { message: 400, edit: 8 * 1024 };
const HEAP_EDITS = 20;
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
const SERVER_RENDER = "grai's plugin, a server render";
const variants = [...designs, SERVER_RENDER];

const spread = (samples) => ({
	median: median(samples),
	...medianInterval(samples),
	samples,
});

/** A design's figures over its sessions, as results/hmr-*.json has them. */
function designRow(design, sessions, serverRender) {
	const edits = sessions.flatMap((session) => session.samples);
	const part = (field) =>
		edits.length === 0 ? undefined : median(edits.map((edit) => edit[field]));
	const heap = {
		load: median(sessions.map((session) => session.heap.load)),
		edits: median(sessions.map((session) => session.heap.edits)),
		sessions: sessions.map((session) => session.heap),
	};
	return {
		design,
		pageLoad: median(sessions.map((session) => session.load)),
		editToPage: part("total"),
		...(design === "grai's plugin" && {
			editToServer: median(serverRender.map((edit) => edit.server)),
			serverRender: spread(serverRender.map((edit) => edit.server)),
		}),
		heap,
		watcher: part("watcher"),
		plugin: part("plugin"),
		browser: part("browser"),
		generated: sessions[0].generate,
		edits:
			edits.length === 0 ? undefined : spread(edits.map((edit) => edit.total)),
		loads: spread(sessions.map((session) => session.load)),
	};
}

function print(app, rows, pairs, rounds, chromiumVersion) {
	const ms = (value) => (value === undefined ? "—" : value.toFixed(1));
	const range = (figure) =>
		figure === undefined
			? "—"
			: `${figure.median.toFixed(1)} (${figure.low.toFixed(1)}–${figure.high.toFixed(1)})`;
	const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	console.log(
		`\n### ${app.name}: one message edited until the page shows it, Vite dev, Chromium ${chromiumVersion}, ${rounds} rounds of every design's session in rotating order, ${EDITS} edits a session after ${WARMUPS} not counted, medians (intervals), ms; the page's heap once collected\n`,
	);
	console.log(
		"| design | dev module, generated in | page load | edit to page | edit to server render | watcher | plugin | browser | heap at load | heap after the edits |\n|---|---|---|---|---|---|---|---|---|---|",
	);
	for (const row of rows) {
		const served = row.generated
			? `${megabytes(row.generated.bytes)}, ${row.generated.ms.toFixed(0)} ms`
			: "—";
		console.log(
			`| ${row.design} | ${served} | ${row.pageLoad.toFixed(0)} | ${range(row.edits)} | ${range(row.serverRender)} | ${ms(row.watcher)} | ${ms(row.plugin)} | ${ms(row.browser)} | ${megabytes(row.heap.load)} | ${megabytes(row.heap.edits)} |`,
		);
	}
	console.log(
		"\nPaired by round, a design's median edit over grai's plugin's:\n",
	);
	for (const [design, ratio] of Object.entries(pairs))
		console.log(`- ${design}: ${ratioText(ratio)}`);
}

/**
 * Holds grai's plugin's heap to its budget: at load, over the page with no messages, and after the
 * edits of `heapSession`, a session of its own.
 */
function checkHeap(app, rows, heapSession) {
	const heapOf = (design) => rows.find((row) => row.design === design).heap;
	const grai = heapOf("grai's plugin");
	const none = heapOf("no messages");
	const messages =
		app.locales.length * Object.keys(app.messages[app.baseLocale]).length;
	const perMessage = (grai.load - none.load) / messages;
	const { heap } = heapSession;
	const perEdit = (heap.edits - heap.load) / (WARMUPS + HEAP_EDITS);
	const over = perMessage > HEAP_BUDGET.message || perEdit > HEAP_BUDGET.edit;
	console.log(
		`\ngrai's plugin keeps ${perMessage.toFixed(0)} B a message over the page with no messages (budget ${HEAP_BUDGET.message} B), and ${(perEdit / 1024).toFixed(1)} KB more an edit (budget ${HEAP_BUDGET.edit / 1024} KB)${over ? ": over budget" : ""}`,
	);
	if (over) process.exitCode = 1;
}

const browser = await chromium.launch();
try {
	for (const app of selectedApps()) {
		const rounds = roundCount(variants.length);
		const kept = await inRounds(variants, rounds, (variant, round) =>
			variant === SERVER_RENDER
				? serverRenderSession(app, round)
				: pageSession(browser, app, variant, round),
		);
		const sessions = (variant) =>
			kept.map((round) => round.measured.get(variant));
		const serverRender = sessions(SERVER_RENDER).flatMap(
			(each) => each.samples,
		);
		const rows = designs.map((design) =>
			designRow(design, sessions(design), serverRender),
		);
		/** A design's median edit in each round. */
		const byRound = (design) =>
			sessions(design).map((session) =>
				median(session.samples.map((sample) => sample.total)),
			);
		const pairs = Object.fromEntries(
			designs
				.filter((design) => !["grai's plugin", "no messages"].includes(design))
				.map((design) => [
					design,
					pairedRatio(byRound(design), byRound("grai's plugin")),
				]),
		);
		print(app, rows, pairs, rounds, browser.version());
		const heapSession = await pageSession(
			browser,
			app,
			"grai's plugin",
			rounds,
			HEAP_EDITS,
		);
		recordResults(`hmr-${app.id}`, rows, {
			app: app.name,
			edits: rounds * EDITS,
			chromium: browser.version(),
			pairs,
			rounds: roundsRecord(kept),
			heapSession: heapSession.heap,
		});
		checkHeap(app, rows, heapSession);
	}
} finally {
	await browser.close();
}
