// Next.js App Router: grai against next-intl on the same page (next-apps.mjs), in one locale.
//   pnpm nextjs [app]      the synthetic catalog by default; a or b with GRAI_BENCH_A or _B
// - Bytes: each app is built (`next build`, Turbopack) and started, Chromium loads the page, and
//   every response the page downloads is compressed with brotli at quality 11. "Beyond plain" is
//   what the page costs more than the same page with its words written in.
// - Start: `next dev` until it is ready, then until the page's first response, from an empty .next
//   and from the one the last run left. grai's share is withGrai's work when `next dev` asks for
//   its config, in a process of its own, from an empty outdir and from one already up to date.
// - Edit to page: one message edited in its catalog until the page in `next dev` shows it, for a
//   message in the server component and one in the client component; the median of EDITS saves.
//   For grai, also until it wrote the edited shard: the rest is Next's.
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
import { startServer, stopServer } from "./servers.mjs";

const EDITS = 7;
const SAVE_INTERVAL_MS = 1500;
const next = new URL("node_modules/.bin/next", import.meta.url).pathname;
const nextVersion = JSON.parse(
	readFileSync(new URL("node_modules/next/package.json", import.meta.url)),
).version;

const brotli = (bytes) =>
	brotliCompressSync(bytes, {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
	}).length;
const kb = (bytes) => (bytes / 1024).toFixed(1);
const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const now = () => performance.timeOrigin + performance.now();
/** Next's environment: no telemetry, which would phone home and outlive the run in a process of its own. */
const env = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };

/**
 * Starts `next <command>` in an app on a port the system picks, so that runs side by side never
 * meet, and resolves with the URL it serves once it prints a line matching `ready`.
 */
function started(root, command, ready) {
	const child = startServer(next, [command, "--port", "0"], {
		cwd: root,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	const listening = new Promise((resolve, reject) => {
		const deadline = setTimeout(
			() =>
				reject(new Error(`next ${command} was not ready in 120 s:\n${output}`)),
			120_000,
		);
		const read = (chunk) => {
			output += chunk;
			const origin = /- Local:\s+(http:\/\/\S+)/.exec(output)?.[1];
			if (origin !== undefined && ready.test(output)) {
				clearTimeout(deadline);
				resolve(origin);
			}
		};
		child.stdout.on("data", read);
		child.stderr.on("data", read);
	});
	return { child, listening, output: () => output };
}

/** Requests a URL until it answers 200, for at most two minutes; resolves with the time it took. */
async function firstResponse(url) {
	const start = performance.now();
	while (performance.now() - start < 120_000) {
		const response = await fetch(url).catch(() => undefined);
		if (response?.ok) {
			await response.text();
			return performance.now() - start;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`${url} did not answer in 120 s`);
}

/** The page's downloads in a built app, brotli-compressed: its document, its scripts, the rest. */
async function pageBytes(browser, root, path) {
	const build = spawnSync(next, ["build"], {
		cwd: root,
		env,
		encoding: "utf8",
	});
	if (build.status !== 0) throw new Error(build.stdout + build.stderr);
	const server = started(root, "start", /Ready|started/);
	const origin = await server.listening;
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

/** withGrai's work for `next dev`, in a fresh process: from an empty outdir, then from a current one. */
function graiShare(root) {
	const once = () => {
		const run = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`const start = performance.now();
const { withGrai } = await import("grai/next/config");
await withGrai({})("phase-development-server");
console.log(performance.now() - start);
process.exit(0);`,
			],
			{ cwd: root, encoding: "utf8" },
		);
		if (run.status !== 0) throw new Error(run.stderr);
		return Number(run.stdout.trim());
	};
	rmSync(join(root, "src/i18n"), { recursive: true, force: true });
	const cold = once();
	return { cold, warm: median([once(), once(), once()]) };
}

/** `next dev` until it is ready, then until the page's first response: from an empty .next, or not. */
async function devStart(root, path, { empty }) {
	if (empty) rmSync(join(root, ".next"), { recursive: true, force: true });
	const start = performance.now();
	const server = started(root, "dev", /Ready in/);
	const origin = await server.listening;
	const ready = performance.now() - start;
	const page = await firstResponse(`${origin}${path}`);
	return { server, url: `${origin}${path}`, ready, page };
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
	const { keys, apps } = await writeNextApps(app, locale);
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
	for (const [name, sizes] of Object.entries(bytes)) {
		console.log(
			`| ${name} | ${kb(sizes.document)} | ${kb(sizes.script)} | ${kb(sizes.other)} | ${kb(total(sizes))} | ${name === "plain" ? "" : kb(total(sizes) - total(bytes.plain))} |`,
		);
	}

	const share = graiShare(apps.grai);
	console.log(
		`\ngrai's share of \`next dev\`'s start: ${share.cold.toFixed(0)} ms from an empty outdir, ${share.warm.toFixed(0)} ms with the outdir up to date (withGrai in a fresh process, its import included).\n`,
	);

	console.log(
		"`next dev`: until ready and the page's first response, from an empty .next and from the last run's; then one message edited until the page shows it, and until grai wrote it, ms\n",
	);
	console.log(
		"| app | ready, empty .next | page | ready, .next kept | page | edit, server component | edit, client component |",
	);
	console.log("|---|---|---|---|---|---|---|");
	for (const name of ["grai", "next-intl"]) {
		const root = apps[name];
		const empty = await devStart(root, path, { empty: true });
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
		const kept = await devStart(root, path, { empty: false });
		await stopServer(kept.server.child);
		const edit = ({ shown, written }) =>
			written === undefined
				? shown.toFixed(0)
				: `${shown.toFixed(0)} (written in ${written.toFixed(1)})`;
		console.log(
			`| ${name} | ${empty.ready.toFixed(0)} | ${empty.page.toFixed(0)} | ${kept.ready.toFixed(0)} | ${kept.page.toFixed(0)} | ${edit(edits.server)} | ${edit(edits.client)} |`,
		);
	}
}
await browser.close();
