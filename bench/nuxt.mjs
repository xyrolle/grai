// Nuxt: @xyrolle/grai/nuxt against @nuxtjs/i18n on the same page (nuxt-apps.mjs), in a non-base
// locale.
//   pnpm nuxt [app]      the synthetic catalog by default; a or b with GRAI_BENCH_A or _B
// - Page JS: each app is built by `nuxt build` and served by its Node server, and Chromium loads
//   the page; each script it downloads is compressed with brotli at quality 11. "Beyond plain" is
//   what the page costs more than the same page with its words written in.
// - Hydrated: from the navigation's start until Nuxt has hydrated the page, the median of RUNS
//   loads, each in a context of its own, the apps taking turns, at each CPU slowdown.
// - Edit to page: one message edited in its catalog until the page under `nuxt dev` shows it, the
//   median of EDITS saves.
import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { chromium } from "playwright-core";
import { selectedApps } from "./apps.mjs";
import { writeNuxtApps } from "./nuxt-apps.mjs";

const RUNS = 11;
const EDITS = 7;
const THROTTLING = [1, 4];
const SAVE_INTERVAL_MS = 1500;
/** The port of `nuxt dev`, and of each built app's server, which run side by side. */
const PORT = 4824;
const SERVED_PORTS = [4822, 4823, 4824];
const nuxt = new URL("node_modules/.bin/nuxt", import.meta.url).pathname;
/** No telemetry, which would phone home and outlive the run in a process of its own. */
const env = { ...process.env, NUXT_TELEMETRY_DISABLED: "1" };
const versionOf = (name) =>
	JSON.parse(
		readFileSync(new URL(`node_modules/${name}/package.json`, import.meta.url)),
	).version;

const brotli = (bytes) =>
	brotliCompressSync(bytes, {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
	}).length;
const kb = (bytes) => (bytes / 1024).toFixed(1);
const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const now = () => performance.timeOrigin + performance.now();

/** The servers this run started, which it stops when it ends, a failure's end too. */
const running = new Set();
process.on("exit", () => {
	for (const child of running) child.kill();
});

/** Starts a command in an app, and resolves once it prints a line matching `ready`. */
function started(root, command, args, ready, extra = {}) {
	const child = spawn(command, args, {
		cwd: root,
		env: { ...env, ...extra },
		stdio: ["ignore", "pipe", "pipe"],
	});
	running.add(child);
	child.on("exit", () => running.delete(child));
	let output = "";
	const listening = new Promise((resolve, reject) => {
		const deadline = setTimeout(
			() => reject(new Error(`${command} was not ready in 120 s:\n${output}`)),
			120_000,
		);
		const read = (chunk) => {
			output += chunk;
			if (ready.test(output)) {
				clearTimeout(deadline);
				resolve();
			}
		};
		child.stdout.on("data", read);
		child.stderr.on("data", read);
		child.on("exit", (code) =>
			reject(new Error(`${command} exited: ${code}\n${output}`)),
		);
	});
	return { child, listening };
}

async function stopped(server) {
	const exited = new Promise((resolve) => server.child.on("exit", resolve));
	server.child.kill();
	await exited;
}

/**
 * Loads the page in a fresh context at a CPU slowdown: when it hydrated, the text it shows and,
 * if asked, the brotli bytes of the scripts it downloaded.
 */
async function load(browser, url, rate, { bytes = false } = {}) {
	const context = await browser.newContext();
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send("Emulation.setCPUThrottlingRate", { rate });
	const scripts = [];
	if (bytes) {
		page.on("response", (response) => {
			if (response.request().resourceType() === "script")
				scripts.push(response.body().then(brotli));
		});
	}
	await page.goto(url);
	const hydrated = await page
		.waitForFunction(() => window.hydrated)
		.then((handle) => handle.jsonValue());
	const text = await page.locator("ul").textContent();
	const scriptBytes = (await Promise.all(scripts)).reduce((a, b) => a + b, 0);
	await context.close();
	return { hydrated, text, scriptBytes };
}

/** A message's text in its catalog, edited and saved; returns when saved. */
function save(catalogFile, key, text) {
	const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
	catalog[key] = text;
	writeFileSync(catalogFile, JSON.stringify(catalog, null, "\t"));
	return now();
}

/** One message edited EDITS times until the page under `nuxt dev` shows it: the median, ms. */
async function editToPage(browser, root, path, catalogFile, key) {
	const server = started(root, nuxt, ["dev", "--port", String(PORT)], /Local:/);
	await server.listening;
	const page = await browser.newPage();
	await page.goto(`http://localhost:${PORT}${path}`, { timeout: 120_000 });
	await page.waitForFunction(() => "changes" in window, null, {
		timeout: 120_000,
	});
	const original = JSON.parse(readFileSync(catalogFile, "utf8"))[key];
	const latencies = [];
	for (let edit = 0; edit < EDITS + 2; edit++) {
		await new Promise((resolve) => setTimeout(resolve, SAVE_INTERVAL_MS));
		const text = `Edit ${edit}: ${original}`;
		const saved = save(catalogFile, key, text);
		const shown = await page
			.waitForFunction(
				(text) =>
					window.changes?.target?.text === text && window.changes.target.at,
				text,
				{ timeout: 60_000 },
			)
			.then(
				(handle) => handle.jsonValue(),
				() => undefined,
			);
		if (shown === undefined) break;
		// The first two warm the dev server's compiles of the edited module.
		if (edit >= 2) latencies.push(shown - saved);
	}
	save(catalogFile, key, original);
	await page.close();
	await stopped(server);
	// Undefined when an edit did not show within a minute.
	return latencies.length === EDITS ? median(latencies) : undefined;
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	const locale = app.locales.find((other) => other !== app.baseLocale);
	const path = `/${locale}/`;
	const { page, apps } = await writeNuxtApps(app, locale);
	console.log(
		`\n### ${app.name}: a page of ${page.keys.length} messages at ${path}; Nuxt ${versionOf("nuxt")}, @nuxtjs/i18n ${versionOf("@nuxtjs/i18n")}, Chromium ${browser.version()}\n`,
	);

	const served = Object.entries(apps).map(([name, root], index) => {
		const build = spawnSync(nuxt, ["build"], {
			cwd: root,
			env,
			encoding: "utf8",
		});
		if (build.status !== 0) throw new Error(build.stdout + build.stderr);
		const port = SERVED_PORTS[index];
		const server = started(
			root,
			"node",
			[".output/server/index.mjs"],
			/Listening on/,
			{ PORT: String(port) },
		);
		return { name, server, url: `http://localhost:${port}${path}` };
	});
	await Promise.all(served.map(({ server }) => server.listening));
	const results = {};
	for (const { name, url } of served) {
		const first = await load(browser, url, 1, { bytes: true });
		results[name] = { ...first, hydrated: THROTTLING.map(() => []) };
	}
	for (const [slowdown, rate] of THROTTLING.entries()) {
		for (let run = 0; run < RUNS; run++) {
			for (const { name, url } of served) {
				results[name].hydrated[slowdown].push(
					(await load(browser, url, rate)).hydrated,
				);
			}
		}
	}
	await Promise.all(served.map(({ server }) => stopped(server)));
	const texts = new Set(
		Object.values(results).map(({ text }) => text.replace(/\s+/g, "")),
	);
	if (texts.size !== 1) throw new Error("the apps' pages show different text");

	console.log(
		`Page JS, brotli KB, and until hydrated, the median of ${RUNS} loads, ms\n`,
	);
	console.log(
		`| app | page JS | beyond plain | ${THROTTLING.map((rate) => `hydrated, ${rate}× CPU`).join(" | ")} |`,
	);
	console.log(`|---|---|---|${THROTTLING.map(() => "---").join("|")}|`);
	for (const [name, { scriptBytes, hydrated }] of Object.entries(results)) {
		const beyond =
			name === "plain" ? "" : kb(scriptBytes - results.plain.scriptBytes);
		const times = hydrated.map((runs) => median(runs).toFixed(1));
		console.log(
			`| ${name} | ${kb(scriptBytes)} | ${beyond} | ${times.join(" | ")} |`,
		);
	}

	console.log(
		`\nOne message edited until the page under \`nuxt dev\` shows it, the median of ${EDITS} saves, ms\n`,
	);
	console.log("| app | edit to page |");
	console.log("|---|---|");
	const catalogs = {
		grai: join(apps.grai, "messages", `${locale}.json`),
		"@nuxtjs/i18n": join(
			apps["@nuxtjs/i18n"],
			"i18n/locales",
			`${locale}.json`,
		),
	};
	for (const [name, catalogFile] of Object.entries(catalogs)) {
		const shown = await editToPage(
			browser,
			apps[name],
			path,
			catalogFile,
			page.target,
		);
		console.log(
			`| ${name} | ${shown === undefined ? "not shown within 60 s" : shown.toFixed(0)} |`,
		);
	}
}
await browser.close();
