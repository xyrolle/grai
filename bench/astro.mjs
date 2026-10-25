// Astro: grai against Paraglide on the same static site (astro-apps.mjs), on one locale's page.
//   pnpm astro [app]      the synthetic catalog by default; a or b with GRAI_BENCH_A or _B
// It installs grai from the repository's build, so it runs after `pnpm build` at the root.
// - Build: `astro build` from a clean checkout (no dist, no compiled output), the median of RUNS.
// - Bytes: the last build served by `astro preview`; Chromium loads the page, and every response
//   it downloads is compressed with brotli at quality 11. "Beyond plain" is what the page costs
//   more than the same page with its words written in.
// - Dev: `astro dev` from a clean checkout until it is ready, then until the page's first
//   response; then one message edited in its catalog until the open page shows it, for a message
//   in the page and one in the island: the median of EDITS saves, or "not shown" when an edit
//   has not shown within SHOW_TIMEOUT_MS. Every server stops however the bench ends.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { chromium } from "playwright-core";
import { selectedApps } from "./apps.mjs";
import { writeAstroApps } from "./astro-apps.mjs";

const RUNS = 3;
const EDITS = 7;
const SHOW_TIMEOUT_MS = 30_000;
const SAVE_INTERVAL_MS = 1500;
const PREVIEW_PORT = 4828;
const DEV_PORT = 4829;
const astro = new URL("node_modules/.bin/astro", import.meta.url).pathname;
const versionOf = (name) =>
	JSON.parse(
		readFileSync(new URL(`node_modules/${name}/package.json`, import.meta.url)),
	).version;

const brotli = (bytes) =>
	brotliCompressSync(bytes, {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
	}).length;
const kb = (bytes) => (bytes / 1024).toFixed(1);
const ms = (value) => value.toFixed(0);
const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const load = () =>
	loadavg()
		.map((value) => value.toFixed(1))
		.join(" ");
/** Astro's environment: no telemetry, which would phone home from every run. */
const env = { ...process.env, ASTRO_TELEMETRY_DISABLED: "1" };

/** What a clean checkout lacks: the build, Astro's generated types and each library's output. */
function cleaned(root) {
	for (const path of ["dist", ".astro", "src/i18n", "src/paraglide"])
		rmSync(join(root, path), { recursive: true, force: true });
}

/** `astro build` from a clean checkout; resolves with the time it took. */
function buildTime(root) {
	cleaned(root);
	const start = performance.now();
	const build = spawnSync(astro, ["build"], {
		cwd: root,
		env,
		encoding: "utf8",
	});
	if (build.status !== 0) throw new Error(build.stdout + build.stderr);
	return performance.now() - start;
}

/** The servers running, each a process group, which none of outlives the bench. */
const running = new Set();
const stopGroup = (child) => {
	if (child.exitCode === null && child.signalCode === null)
		process.kill(-child.pid, "SIGTERM");
};
process.on("exit", () => running.forEach(stopGroup));
for (const signal of ["SIGINT", "SIGTERM"]) {
	process.on(signal, () => process.exit(1));
}

/**
 * Starts `astro <args>` in the foreground, in a process group of its own, resolving once it prints
 * its local URL. With --ignore-lock, a one-off server: Astro starts `dev` and `preview` in the
 * background, out of the bench's reach, when an agent runs the bench.
 */
function started(root, args) {
	const child = spawn(
		astro,
		[...args, "--host", "127.0.0.1", "--ignore-lock"],
		{
			cwd: root,
			env,
			detached: true,
		},
	);
	running.add(child);
	child.on("exit", () => running.delete(child));
	let output = "";
	const ready = new Promise((resolve, reject) => {
		const deadline = setTimeout(
			() =>
				reject(
					new Error(`astro ${args[0]} was not ready in 120 s:\n${output}`),
				),
			120_000,
		);
		const read = (chunk) => {
			output += chunk;
			if (/127\.0\.0\.1:\d+/.test(output)) {
				clearTimeout(deadline);
				resolve();
			}
		};
		child.stdout.on("data", read);
		child.stderr.on("data", read);
		child.on("exit", (code) =>
			reject(new Error(`astro ${args[0]} exited: ${code}\n${output}`)),
		);
	});
	return { child, ready };
}

/** Stops a server's process group, resolving once the server has exited. */
async function stopped(server) {
	if (!running.has(server.child)) return;
	const exited = new Promise((resolve) => server.child.on("exit", resolve));
	stopGroup(server.child);
	await exited;
}

/** Runs `use` while `astro <args>` serves, and stops the server however `use` ends. */
async function withServer(root, args, use) {
	const server = started(root, args);
	try {
		await server.ready;
		return await use();
	} finally {
		await stopped(server);
	}
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
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error(`${url} did not answer in 120 s`);
}

/** The page's downloads in the last build, brotli-compressed: its document, its scripts, the rest. */
async function pageBytes(browser, root, path) {
	return withServer(root, ["preview", "--port", String(PREVIEW_PORT)], () =>
		downloads(browser, `http://127.0.0.1:${PREVIEW_PORT}${path}`),
	);
}

async function downloads(browser, url) {
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
	await page.goto(url, { waitUntil: "networkidle" });
	await Promise.all(bodies);
	await page.close();
	return sizes;
}

/** A message's text in its catalog edited and saved; returns when it was saved. */
function save(catalogFile, key, text) {
	const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
	catalog[key] = text;
	writeFileSync(catalogFile, JSON.stringify(catalog, null, "\t"));
	return performance.now();
}

/**
 * One message edited EDITS times until the dev page shows it: the median, ms, or undefined when
 * an edit has not shown within SHOW_TIMEOUT_MS.
 */
async function editToPage(browser, url, catalogFile, key, target) {
	const page = await browser.newPage();
	await page.goto(url);
	const original = JSON.parse(readFileSync(catalogFile, "utf8"))[key];
	const latencies = [];
	try {
		for (let edit = 0; edit < EDITS + 2; edit++) {
			await new Promise((resolve) => setTimeout(resolve, SAVE_INTERVAL_MS));
			const text = `Edit ${edit}: ${original}`;
			const saved = save(catalogFile, key, text);
			const shown = await page
				.locator(`#${target}-target`, { hasText: text })
				.waitFor({ timeout: SHOW_TIMEOUT_MS })
				.then(
					() => true,
					() => false,
				);
			if (!shown) return undefined;
			// The first two warm the dev server's transforms of the edited modules.
			if (edit >= 2) latencies.push(performance.now() - saved);
		}
		return median(latencies);
	} finally {
		save(catalogFile, key, original);
		await page.close();
	}
}

/** `astro dev` from a clean checkout until ready and the page's first response, then the edits. */
async function dev(browser, root, path, edits) {
	cleaned(root);
	const start = performance.now();
	return withServer(root, ["dev", "--port", String(DEV_PORT)], async () => {
		const ready = performance.now() - start;
		const url = `http://127.0.0.1:${DEV_PORT}${path}`;
		const first = await firstResponse(url);
		const edited = {};
		for (const [target, { catalogFile, key }] of Object.entries(edits))
			edited[target] = await editToPage(browser, url, catalogFile, key, target);
		return { ready, first, edited };
	});
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	const locale = app.locales.find((other) => other !== app.baseLocale);
	const path = `/${locale}/`;
	const { keys, apps } = await writeAstroApps(app);
	console.log(
		`\n### ${app.name}: a page of ${keys.server.length} messages and a Svelte island of ${keys.client.length}, in ${locale}; Astro ${versionOf("astro")}, Paraglide ${versionOf("@inlang/paraglide-js")}, Chromium ${browser.version()}; load ${load()}\n`,
	);

	console.log(
		`\`astro build\` from a clean checkout, the median of ${RUNS}, ms; then the bytes the page downloads, brotli, KB\n`,
	);
	console.log(
		"| app | build | document | scripts | other | total | beyond plain |",
	);
	console.log("|---|---|---|---|---|---|---|");
	const results = {};
	for (const [name, root] of Object.entries(apps)) {
		const build = median(Array.from({ length: RUNS }, () => buildTime(root)));
		results[name] = { build, sizes: await pageBytes(browser, root, path) };
	}
	const total = ({ document, script, other }) => document + script + other;
	for (const [name, { build, sizes }] of Object.entries(results)) {
		const beyond = total(sizes) - total(results.plain.sizes);
		console.log(
			`| ${name} | ${ms(build)} | ${kb(sizes.document)} | ${kb(sizes.script)} | ${kb(sizes.other)} | ${kb(total(sizes))} | ${name === "plain" ? "" : kb(beyond)} |`,
		);
	}

	console.log(
		"\n`astro dev` from a clean checkout: until ready, then until the page's first response; then one message edited in its catalog until the page shows it, the median, ms\n",
	);
	console.log(
		"| app | ready | first response | edit, in the page | edit, in the island |",
	);
	console.log("|---|---|---|---|---|");
	for (const name of ["grai", "paraglide", "plain"]) {
		const root = apps[name];
		const catalogFile = join(root, "messages", `${locale}.json`);
		const edits =
			name === "plain"
				? {}
				: {
						server: { catalogFile, key: keys.targets.server },
						client: { catalogFile, key: keys.targets.client },
					};
		const { ready, first, edited } = await dev(browser, root, path, edits);
		const cell = (target) =>
			!(target in edited)
				? ""
				: edited[target] === undefined
					? `not shown in ${SHOW_TIMEOUT_MS / 1000} s`
					: ms(edited[target]);
		console.log(
			`| ${name} | ${ms(ready)} | ${ms(first)} | ${cell("server")} | ${cell("client")} |`,
		);
	}
	console.log(`\nload at the end: ${load()}`);
}
await browser.close();
