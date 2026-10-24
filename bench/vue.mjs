// Vue on Vite: grai against vue-i18n on the same server-rendered page (vue-apps.mjs), in one locale.
//   pnpm vue [app]      the synthetic catalog by default; a or b with GRAI_BENCH_A or _B
// - Page JS: each app is built, client and server, the server renders the page in the locale, and
//   Chromium loads it; each script it downloads is compressed with brotli at quality 11. "Beyond
//   plain" is what the page costs more than the same page with its words written in.
// - Hydrated: from the navigation's start until the app has hydrated, the median of RUNS loads,
//   each in a context of its own, the apps taking turns, at each CPU slowdown.
// - Edit to page: one message edited in its catalog until the page under Vite's dev server shows
//   it, the median of EDITS saves.
import { readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";
import { chromium } from "playwright-core";
import { build, createServer } from "vite";
import { selectedApps } from "./apps.mjs";
import { writeVueApps } from "./vue-apps.mjs";

const RUNS = 11;
const EDITS = 7;
const THROTTLING = [1, 4];
const SAVE_INTERVAL_MS = 1500;
const PORT = 4824;
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

/** Builds an app, client and server, and renders its page on the server in `locale`. */
async function builtPage(root, locale) {
	await build({ root, logLevel: "silent", build: { outDir: "dist/client" } });
	await build({
		root,
		logLevel: "silent",
		build: { ssr: "src/entry-server.js", outDir: "dist/server" },
	});
	const { render } = await import(
		pathToFileURL(join(root, "dist/server/entry-server.js")).href
	);
	return readFileSync(join(root, "dist/client/index.html"), "utf8")
		.replace("%lang%", locale)
		.replace("<!--app-->", await render(locale));
}

const contentTypes = { ".js": "text/javascript", ".css": "text/css" };

/**
 * Loads the built page in a fresh context at a CPU slowdown: when it hydrated, the text it shows
 * and, if asked, the brotli bytes of the scripts it downloaded.
 */
async function load(browser, root, html, rate, { bytes = false } = {}) {
	const context = await browser.newContext();
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send("Emulation.setCPUThrottlingRate", { rate });
	await page.route("http://bench.test/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		return path === "/"
			? route.fulfill({ contentType: "text/html", body: html })
			: route.fulfill({
					contentType: contentTypes[extname(path)] ?? "text/plain",
					body: readFileSync(join(root, "dist/client", path)),
				});
	});
	const scripts = [];
	if (bytes) {
		page.on("response", (response) => {
			if (response.request().resourceType() === "script")
				scripts.push(response.body().then(brotli));
		});
	}
	await page.goto("http://bench.test/");
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

/** One message edited EDITS times until the dev page shows it: the median, ms. */
async function editToPage(browser, root, locale, catalogFile, key) {
	const server = await createServer({
		root,
		logLevel: "silent",
		server: { port: PORT, strictPort: true },
		plugins: [
			{
				name: "page-locale",
				transformIndexHtml: (html) => html.replace("%lang%", locale),
			},
		],
	});
	await server.listen();
	const page = await browser.newPage();
	await page.goto(`http://localhost:${PORT}/`);
	await page.waitForFunction(() => "changes" in window);
	const original = JSON.parse(readFileSync(catalogFile, "utf8"))[key];
	const latencies = [];
	for (let edit = 0; edit < EDITS + 2; edit++) {
		await new Promise((resolve) => setTimeout(resolve, SAVE_INTERVAL_MS));
		const text = `Edit ${edit}: ${original}`;
		const saved = save(catalogFile, key, text);
		const shown = await page
			.waitForFunction(
				(text) =>
					window.changes.target?.text === text && window.changes.target.at,
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
	await server.close();
	// Undefined when an edit did not show within a minute.
	return latencies.length === EDITS ? median(latencies) : undefined;
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	const locale = app.locales.find((other) => other !== app.baseLocale);
	const { page, apps } = await writeVueApps(app, locale);
	console.log(
		`\n### ${app.name}: a server-rendered page of ${page.keys.length} messages, in ${locale}; Vue ${versionOf("vue")}, vue-i18n ${versionOf("vue-i18n")}, Vite ${versionOf("vite")}, Chromium ${browser.version()}\n`,
	);

	const pages = {};
	for (const [name, root] of Object.entries(apps)) {
		pages[name] = { root, html: await builtPage(root, locale) };
	}
	const first = await Promise.all(
		Object.values(pages).map(({ root, html }) =>
			load(browser, root, html, 1, { bytes: true }),
		),
	);
	const texts = new Set(first.map(({ text }) => text.replace(/\s+/g, "")));
	if (texts.size !== 1) throw new Error("the apps' pages show different text");
	const bytes = Object.fromEntries(
		Object.keys(pages).map((name, index) => [name, first[index].scriptBytes]),
	);
	const hydrated = Object.fromEntries(
		Object.keys(pages).map((name) => [name, THROTTLING.map(() => [])]),
	);
	for (const [slowdown, rate] of THROTTLING.entries()) {
		for (let run = 0; run < RUNS; run++) {
			for (const [name, { root, html }] of Object.entries(pages)) {
				hydrated[name][slowdown].push(
					(await load(browser, root, html, rate)).hydrated,
				);
			}
		}
	}
	console.log(
		`Page JS, brotli KB, and until hydrated, the median of ${RUNS} loads, ms\n`,
	);
	console.log(
		`| app | page JS | beyond plain | ${THROTTLING.map((rate) => `hydrated, ${rate}× CPU`).join(" | ")} |`,
	);
	console.log(`|---|---|---|${THROTTLING.map(() => "---").join("|")}|`);
	for (const name of Object.keys(pages)) {
		const beyond = name === "plain" ? "" : kb(bytes[name] - bytes.plain);
		const times = hydrated[name].map((runs) => median(runs).toFixed(1));
		console.log(
			`| ${name} | ${kb(bytes[name])} | ${beyond} | ${times.join(" | ")} |`,
		);
	}

	console.log(
		`\nOne message edited until the page under Vite's dev server shows it, the median of ${EDITS} saves, ms\n`,
	);
	console.log("| app | edit to page |");
	console.log("|---|---|");
	const catalogs = {
		grai: join(apps.grai, "messages", `${locale}.json`),
		"vue-i18n": join(apps["vue-i18n"], "src/locales", `${locale}.json`),
	};
	for (const [name, catalogFile] of Object.entries(catalogs)) {
		const shown = await editToPage(
			browser,
			apps[name],
			locale,
			catalogFile,
			page.target,
		);
		console.log(
			`| ${name} | ${shown === undefined ? "not shown within 60 s" : shown.toFixed(0)} |`,
		);
	}
}
await browser.close();
