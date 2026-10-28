// One message edited in its catalog until the page in `next dev` shows it (nextjs.mjs), in the
// server component and in the client component, on grai, on next-intl with its provider passing
// the client component every message, as by default, and with only the client component's keys,
// as its docs advise. Each round starts each app's dev server once from an empty .next, in an
// order that rotates (rounds.mjs): a session. A session opens the page in Chromium, then edits each
// component's message in turn, the components' order rotating too: WARMUPS edits that warm the
// dev server's compiles of the edited module, not counted, then EDITS timed from the catalog's save
// until the page's Observer saw the edited text. For grai, also until it wrote the edited shard.
// After each edit the whole page must list every message, the edit in its place; the catalog is
// then saved back, and the page must list every message as before, ahead of the next edit. A page
// error or a hydration error fails the session. A session ends with a start of its own from the
// .next it left. Every sample is kept with its round's load, and each round pairs grai's median
// edit with each next-intl app's.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { median, medianInterval } from "./medians.mjs";
import { assertListed, devStart } from "./next-dev.mjs";
import {
	inRounds,
	pairedRatio,
	ratioText,
	rotated,
	roundCount,
	roundsRecord,
} from "./rounds.mjs";
import { stopServer } from "./servers.mjs";

const WARMUPS = 2;
const EDITS = 3;
/** Saves come this far apart, so that the file watcher never takes two as one. */
const SAVE_INTERVAL_MS = 1500;
const EDIT_PATIENCE_MS = 60_000;
export const EDIT_APPS = ["grai", "next-intl", "next-intl, client keys picked"];
const components = ["server", "client"];
const now = () => performance.timeOrigin + performance.now();

/** A message's text in its catalog, saved as an editor saves it; returns when. */
function save(catalog, key, text) {
	const messages = JSON.parse(readFileSync(catalog, "utf8"));
	messages[key] = text;
	writeFileSync(catalog, JSON.stringify(messages, null, "\t"));
	return now();
}

/**
 * When grai wrote the shard that holds `text`: its file's modification time. A shard's name carries
 * its content's hash, so an edit writes a new file rather than changing a watched one.
 */
function writtenAt(outdir, text) {
	const keys = join(outdir, "keys");
	for (const name of readdirSync(keys)) {
		const file = join(keys, name);
		if (
			name.endsWith(".js") &&
			readFileSync(file, "utf8").includes(JSON.stringify(text))
		)
			return statSync(file).mtimeMs;
	}
	throw new Error(`No shard of ${outdir} holds ${JSON.stringify(text)}.`);
}

/**
 * Saves `text` as the component's target message, a save interval after the last, and resolves
 * once the page shows it and lists every message with it in place: with ms from the save.
 */
async function shown(view, component, text, words) {
	await delay(SAVE_INTERVAL_MS);
	const saved = save(view.catalog, view.keys.targets[component], text);
	const at = await view.page
		.waitForFunction(
			({ id, text }) =>
				window.changes[id]?.text === text && window.changes[id].at,
			{ id: `${component}-target`, text },
			{ timeout: EDIT_PATIENCE_MS },
		)
		.then((handle) => handle.jsonValue());
	const listed = await view.page.$$eval("li", (items) =>
		items.map((item) => item.textContent),
	);
	if (view.faults.length > 0)
		throw new Error(`${view.url} failed: ${view.faults.join("; ")}`);
	assertListed(listed, words, `${view.url} after ${JSON.stringify(text)}`);
	return { saved, ms: at - saved };
}

/** A component's edits in an open page: each one's ms, and for grai until it wrote the shard. */
async function editsOf(view, component, words) {
	const { server, client, targets } = view.keys;
	const key = targets[component];
	const original = JSON.parse(readFileSync(view.catalog, "utf8"))[key];
	const index =
		component === "server"
			? server.indexOf(key)
			: server.length + client.indexOf(key);
	if (words[index] !== original)
		throw new Error(
			`The page lists ${words[index]} for ${key}, not ${original}.`,
		);
	const samples = [];
	for (let edit = 0; edit < WARMUPS + EDITS; edit++) {
		const text = `Edit ${edit}: ${original}`;
		const edited = words.with(index, text);
		const { saved, ms } = await shown(view, component, text, edited);
		if (edit >= WARMUPS)
			samples.push({
				shown: ms,
				...(view.outdir && { written: writtenAt(view.outdir, text) - saved }),
			});
		await shown(view, component, original, words);
	}
	return samples;
}

/**
 * One session of an app: started from an empty .next, its edits, then a start from the .next it
 * left.
 */
async function session(browser, app, setup, round) {
	const empty = await devStart(app.root, setup.path, setup.words, [".next"]);
	const context = await browser.newContext();
	const edits = {};
	try {
		const page = await context.newPage();
		const faults = [];
		page.on("pageerror", (error) => faults.push(String(error)));
		page.on("console", (message) => {
			if (message.type() === "error") faults.push(message.text());
		});
		await page.goto(empty.url);
		await page.waitForFunction(() => "changes" in window);
		const view = { ...app, ...setup, page, faults, url: empty.url };
		for (const component of rotated(components, round))
			edits[component] = await editsOf(view, component, setup.words);
	} finally {
		await context.close();
		await stopServer(empty.server.child);
	}
	const kept = await devStart(app.root, setup.path, setup.words);
	await stopServer(kept.server.child);
	return {
		empty: { ready: empty.ready, page: empty.page },
		kept: { ready: kept.ready, page: kept.page },
		edits,
	};
}

const spread = (samples) => ({
	median: median(samples),
	...medianInterval(samples),
	samples,
});

/** Each app's figures over its sessions, and grai's edits paired with each next-intl app's. */
function summary(kept) {
	const sessions = (name) => kept.map((round) => round.measured.get(name));
	const dev = {};
	for (const name of EDIT_APPS) {
		const of = (pick) => median(sessions(name).map(pick));
		const edits = {};
		for (const component of components) {
			const samples = sessions(name).flatMap((each) => each.edits[component]);
			const shown = spread(samples.map((sample) => sample.shown));
			edits[component] = {
				shown: shown.median,
				...(samples[0].written !== undefined && {
					written: median(samples.map((sample) => sample.written)),
				}),
				spread: shown,
				samples,
			};
		}
		dev[name] = {
			empty: { ready: of((s) => s.empty.ready), page: of((s) => s.empty.page) },
			kept: { ready: of((s) => s.kept.ready), page: of((s) => s.kept.page) },
			edits,
		};
	}
	/** An app's median edit of a component in each round. */
	const byRound = (name, component) =>
		sessions(name).map((each) =>
			median(each.edits[component].map((sample) => sample.shown)),
		);
	const pairs = {};
	for (const other of EDIT_APPS.slice(1))
		for (const component of components)
			pairs[`${other} over grai, ${component}`] = pairedRatio(
				byRound(other, component),
				byRound("grai", component),
			);
	return { dev, pairs, rounds: roundsRecord(kept) };
}

function print({ dev, pairs }, rounds) {
	const ms = ({ median, low, high }) =>
		`${median.toFixed(0)} (${low.toFixed(0)}–${high.toFixed(0)})`;
	console.log(
		`\nOne message edited until the page shows it: ${rounds} rounds, each app's session in rotating order, ${EDITS} edits a component a session after ${WARMUPS} not counted; medians (intervals), ms; for grai, the median until it wrote the edit in brackets\n`,
	);
	console.log(
		"| app | edit, server component | edit, client component | ready, empty .next | page | ready, .next kept | page |\n|---|---|---|---|---|---|---|",
	);
	for (const [name, { empty, kept, edits }] of Object.entries(dev)) {
		const edit = ({ spread, written }) =>
			`${ms(spread)}${written === undefined ? "" : ` (written in ${written.toFixed(1)})`}`;
		console.log(
			`| ${name} | ${edit(edits.server)} | ${edit(edits.client)} | ${empty.ready.toFixed(0)} | ${empty.page.toFixed(0)} | ${kept.ready.toFixed(0)} | ${kept.page.toFixed(0)} |`,
		);
	}
	console.log("\nPaired by round, an app's median edit over grai's:\n");
	for (const [pair, ratio] of Object.entries(pairs))
		console.log(`- ${pair}: ${ratioText(ratio)}`);
}

/**
 * The edit rounds of the apps `apps` names (next-apps.mjs), on the page at `path` in `locale`, whose
 * messages are `keys` and lists `words`. Returns what results/nextjs-*.json keeps of them.
 */
export async function editRounds(browser, apps, { path, locale, keys, words }) {
	const rounds = roundCount(EDIT_APPS.length, 2);
	const setup = { path, keys, words };
	const kept = await inRounds(EDIT_APPS, rounds, (name, round) =>
		session(
			browser,
			{
				root: apps[name],
				catalog: join(apps[name], "messages", `${locale}.json`),
				outdir: name === "grai" ? join(apps[name], "src/i18n") : undefined,
			},
			setup,
			round,
		),
	);
	const edits = summary(kept);
	print(edits, rounds);
	return { ...edits, edits: rounds * EDITS };
}
