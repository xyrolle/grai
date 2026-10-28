// Next.js App Router: grai against next-intl on the same page (next-apps.mjs), in one locale.
//   pnpm nextjs [app]      the synthetic catalog by default; a or b with GRAI_BENCH_A or _B
// - Bytes: each app is built (`next build`, Turbopack) and started, Chromium loads the page, and
//   every response the page downloads is compressed with brotli at quality 11. "Beyond plain" is
//   what the page costs more than the same page with its words written in.
// - grai's share of a start: withGrai's work when `next dev` asks for its config, in a process of
//   its own, from an empty outdir and from one already up to date: how long it holds Next back,
//   and its CPU until the watch's first compile is done.
// - Edit to page: one message edited in its catalog until the page in `next dev` shows it, in the
//   server component and in the client component, on grai and on next-intl with and without the
//   client component's keys picked, in sessions that take turns, each page checked whole after
//   every edit and its restoration (next-edits.mjs). For grai, also until it wrote the edited shard:
//   the rest is Next's. grai's app starts them with the output its watch leaves after a session,
//   its groups of keys saved. Each session's dev server is timed from its launch until ready and
//   until the page's first response, from an empty .next and from the one it left.
// - Cold first page: `next dev` from an empty .next, from its launch until the page's first response
//   is complete, with the CPU of Next's processes until then, and until the page is hydrated, of
//   which the time after the document's first byte is the page's in Chromium, COLD_ROUNDS times for
//   each app in rotating order, with each round's paired differences (next-cold.mjs).
// Every first response and hydrated page is checked to list each of the page's messages.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { chromium } from "playwright-core";
import { selectedApps } from "./apps.mjs";
import { emptyOutputCopy, writeNextApps } from "./next-apps.mjs";
import {
	COLD_ROUNDS,
	coldApps,
	coldRounds,
	coldSummary,
	printCold,
} from "./next-cold.mjs";
import { devStart, next, nextEnv, nextVersion, started } from "./next-dev.mjs";
import { editRounds } from "./next-edits.mjs";
import { recordResults } from "./results.mjs";
import { stopServer } from "./servers.mjs";

const brotli = (bytes) =>
	brotliCompressSync(bytes, {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
	}).length;
const kb = (bytes) => (bytes / 1024).toFixed(1);
const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** The page's downloads in a built app, brotli-compressed: its document, its scripts, the rest. */
async function pageBytes(browser, root, path) {
	const build = spawnSync(next, ["build"], {
		cwd: root,
		env: nextEnv,
		encoding: "utf8",
	});
	if (build.status !== 0) throw new Error(build.stdout + build.stderr);
	const server = started(root, "start", /Ready|started/);
	const { origin } = await server.listening;
	const page = await browser.newPage();
	const sizes = { document: 0, script: 0, other: 0 };
	const bodies = [];
	page.on("response", (response) => {
		bodies.push(
			response.body().then(
				(body) => {
					const type = response.request().resourceType();
					sizes[type in sizes ? type : "other"] += brotli(body);
				},
				() => {},
			),
		);
	});
	await page.goto(`${origin}${path}`, {
		waitUntil: "networkidle",
	});
	await Promise.all(bodies);
	await page.close();
	await stopServer(server.child);
	return sizes;
}

/**
 * How long the watch's first compile, which runs after withGrai returns when the outdir is current,
 * is given to finish before the CPU is read: it takes about 100 ms on the synthetic catalog.
 */
const WATCH_SETTLE_MS = 1000;

/**
 * withGrai's work for `next dev`, in a fresh process, from an empty outdir and then from a current
 * one: how long it holds Next back, its import included, and the CPU it uses until the watch's
 * first compile is done.
 */
function graiShare(root) {
	const once = () => {
		const run = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`const start = performance.now();
const before = process.cpuUsage();
const { withGrai } = await import("@xyrolle/grai/next/config");
await withGrai({})("phase-development-server");
const call = performance.now() - start;
setTimeout(() => {
	const { user, system } = process.cpuUsage(before);
	console.log(JSON.stringify({ call, cpu: (user + system) / 1000 }));
	process.exit(0);
}, ${WATCH_SETTLE_MS});`,
			],
			{ cwd: root, encoding: "utf8" },
		);
		if (run.status !== 0) throw new Error(run.stderr);
		return JSON.parse(run.stdout.trim());
	};
	rmSync(join(root, "src/i18n"), { recursive: true, force: true });
	const cold = once();
	const warm = [once(), once(), once()];
	return {
		cold,
		warm: {
			call: median(warm.map(({ call }) => call)),
			cpu: median(warm.map(({ cpu }) => cpu)),
		},
	};
}

/**
 * grai's app started until its watch has saved the groups of the keys its routes read
 * (`.grai/groups.json`), which it does once the server is quiet, as a developer's earlier session
 * leaves them; at most two minutes. Gives how many keys each group holds.
 */
async function prepared(root, path, words) {
	const groups = join(root, "src/i18n/.grai/groups.json");
	const { server } = await devStart(root, path, words, [".next"]);
	const deadline = performance.now() + 120_000;
	while (!existsSync(groups) && performance.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	await stopServer(server.child);
	if (!existsSync(groups)) {
		throw new Error(
			`grai's watch saved no groups of keys in two minutes in ${root}`,
		);
	}
	return JSON.parse(readFileSync(groups, "utf8")).map((group) => group.length);
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	const locale = app.locales.find((other) => other !== app.baseLocale);
	const path = `/${locale}`;
	const { keys, words, apps } = await writeNextApps(app, locale);
	console.log(
		`\n### ${app.name}: a page of ${keys.server.length} messages in a server component and ${keys.client.length} in a client component, in ${locale}; Next ${nextVersion}, Turbopack, Chromium ${browser.version()}\n`,
	);

	console.log("Bytes the page downloads, brotli, KB\n");
	console.log("| app | document | scripts | other | total | beyond plain |");
	console.log("|---|---|---|---|---|---|");
	const bytes = {};
	for (const [name, root] of Object.entries(apps)) {
		bytes[name] = await pageBytes(browser, root, path);
	}
	const total = ({ document, script, other }) => document + script + other;
	const recorded = { bytes, dev: {}, cold: {}, pairs: [] };
	for (const [name, sizes] of Object.entries(bytes)) {
		console.log(
			`| ${name} | ${kb(sizes.document)} | ${kb(sizes.script)} | ${kb(sizes.other)} | ${kb(total(sizes))} | ${name === "plain" ? "" : kb(total(sizes) - total(bytes.plain))} |`,
		);
	}

	const share = graiShare(apps.grai);
	console.log(
		`\ngrai's share of \`next dev\`'s start (withGrai in a fresh process, its import included): it holds Next back ${share.cold.call.toFixed(0)} ms from an empty outdir and ${share.warm.call.toFixed(0)} ms with the outdir up to date, and uses ${share.cold.cpu.toFixed(0)} and ${share.warm.cpu.toFixed(0)} ms of CPU until the watch's first compile is done.\n`,
	);

	const groups = await prepared(apps.grai, path, words);
	const edits = await editRounds(browser, apps, { path, locale, keys, words });
	recorded.dev = edits.dev;
	recorded.editPairs = edits.pairs;
	recorded.editRounds = edits.rounds;

	const cold = coldApps(apps, emptyOutputCopy(apps.grai));
	const runs = await coldRounds(browser, cold, path, words, COLD_ROUNDS);
	const summary = coldSummary(runs, cold.length);
	printCold(summary, COLD_ROUNDS);
	for (const [name, measures] of Object.entries(summary.apps)) {
		const medians = Object.entries(measures).map(([measure, { median }]) => [
			measure,
			median,
		]);
		recorded.cold[name] = { ...Object.fromEntries(medians), runs: runs[name] };
	}
	recorded.pairs = summary.pairs;
	recordResults(`nextjs-${app.id}`, recorded, {
		app: app.name,
		locale,
		keys: { server: keys.server.length, client: keys.client.length },
		edits: edits.edits,
		chromium: browser.version(),
		// The output grai's cold rounds start from: the groups its watch saved, by their keys.
		prepared: { groups },
	});
}
await browser.close();
