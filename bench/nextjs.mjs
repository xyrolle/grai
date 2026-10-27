// Next.js App Router: grai against next-intl on the same page (next-apps.mjs), in one locale.
//   pnpm nextjs [app]      the synthetic catalog by default; a or b with GRAI_BENCH_A or _B
// - Bytes: each app is built (`next build`, Turbopack) and started, Chromium loads the page, and
//   every response the page downloads is compressed with brotli at quality 11. "Beyond plain" is
//   what the page costs more than the same page with its words written in.
// - Start: `next dev` from its launch until it is ready, and until the page's first response is
//   complete, from an empty .next and from the one the last run left. grai's share is withGrai's
//   work when `next dev` asks for its config, in a process of its own, from an empty outdir and
//   from one already up to date: how long it holds Next back, and its CPU until the watch's first
//   compile is done.
// - Edit to page: one message edited in its catalog until the page in `next dev` shows it, for a
//   message in the server component and one in the client component; the median of EDITS saves.
//   For grai, also until it wrote the edited shard: the rest is Next's.
// - Cold first page: `next dev` from an empty .next, from its launch until the page's first response
//   is complete, and the CPU of Next's processes until then, COLD_ROUNDS times for each app in
//   rotating order, with each round's paired differences (next-cold.mjs).
// Every first response is checked to list each of the page's messages.
import { spawnSync } from "node:child_process";
import {
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { chromium } from "playwright-core";
import { selectedApps } from "./apps.mjs";
import { writeNextApps } from "./next-apps.mjs";
import {
	COLD_ROUNDS,
	coldApps,
	coldRounds,
	coldSummary,
	printCold,
} from "./next-cold.mjs";
import { devStart, next, nextEnv, nextVersion, started } from "./next-dev.mjs";
import { recordResults } from "./results.mjs";
import { stopServer } from "./servers.mjs";

const EDITS = 7;
const SAVE_INTERVAL_MS = 1500;

const brotli = (bytes) =>
	brotliCompressSync(bytes, {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
	}).length;
const kb = (bytes) => (bytes / 1024).toFixed(1);
const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const now = () => performance.timeOrigin + performance.now();

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

/** A message's text in its catalog, as the page shows it, edited and saved; returns when saved. */
function save(catalogFile, key, text) {
	const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
	catalog[key] = text;
	writeFileSync(catalogFile, JSON.stringify(catalog, null, "\t"));
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
 * One message edited EDITS times until the dev page shows it: the median, ms, and for grai the
 * median until it wrote the edited shard.
 */
async function editToPage(browser, url, catalogFile, key, target, outdir) {
	const page = await browser.newPage();
	await page.goto(url);
	await page.waitForFunction(() => "changes" in window);
	const original = JSON.parse(readFileSync(catalogFile, "utf8"))[key];
	const latencies = [];
	const writes = [];
	for (let edit = 0; edit < EDITS + 2; edit++) {
		await new Promise((resolve) => setTimeout(resolve, SAVE_INTERVAL_MS));
		const text = `Edit ${edit}: ${original}`;
		const written = save(catalogFile, key, text);
		const shown = await page
			.waitForFunction(
				({ id, text }) =>
					window.changes[id]?.text === text && window.changes[id].at,
				{ id: `${target}-target`, text },
				{ timeout: 60_000 },
			)
			.then((handle) => handle.jsonValue());
		// The first two warm the dev server's compiles of the edited module.
		if (edit >= 2) {
			latencies.push(shown - written);
			if (outdir) writes.push(writtenAt(outdir, text) - written);
		}
	}
	save(catalogFile, key, original);
	await page.close();
	return {
		shown: median(latencies),
		written: writes.length > 0 ? median(writes) : undefined,
	};
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

	console.log(
		"`next dev`: from its launch until ready and until the page's first response, from an empty .next and from the last run's; then one message edited until the page shows it, and until grai wrote it, ms\n",
	);
	console.log(
		"| app | ready, empty .next | page | ready, .next kept | page | edit, server component | edit, client component |",
	);
	console.log("|---|---|---|---|---|---|---|");
	for (const name of ["grai", "next-intl"]) {
		const root = apps[name];
		const empty = await devStart(root, path, words, { empty: true });
		const catalogFile = join(root, "messages", `${locale}.json`);
		const outdir = name === "grai" ? join(root, "src/i18n") : undefined;
		const edits = {};
		for (const target of ["server", "client"]) {
			edits[target] = await editToPage(
				browser,
				empty.url,
				catalogFile,
				keys.targets[target],
				target,
				outdir,
			);
		}
		await stopServer(empty.server.child);
		const kept = await devStart(root, path, words, { empty: false });
		await stopServer(kept.server.child);
		const edit = ({ shown, written }) =>
			written === undefined
				? shown.toFixed(0)
				: `${shown.toFixed(0)} (written in ${written.toFixed(1)})`;
		console.log(
			`| ${name} | ${empty.ready.toFixed(0)} | ${empty.page.toFixed(0)} | ${kept.ready.toFixed(0)} | ${kept.page.toFixed(0)} | ${edit(edits.server)} | ${edit(edits.client)} |`,
		);
		recorded.dev[name] = {
			empty: { ready: empty.ready, page: empty.page },
			kept: { ready: kept.ready, page: kept.page },
			edits,
		};
	}

	const cold = coldApps(apps);
	const runs = await coldRounds(cold, path, words, COLD_ROUNDS);
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
		edits: EDITS,
		chromium: browser.version(),
	});
}
await browser.close();
