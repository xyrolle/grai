// Real pages of a SvelteKit app built as it is and with text inlined into its templates
// (inline-build.mjs), served side by side. Each page is first compared exactly, as the server
// draws it and as hydration leaves it: its text, whitespace included, its elements and attributes,
// and Svelte's hydration markers, so the server draws the same document in both builds. Then each
// page is loaded in Chromium until SvelteKit has hydrated it, at full speed and at a 4× slowdown,
// each load in a fresh context and alternating between the servers, and its JS is weighed. Pages
// behind a sign-in take a Playwright storage state.
//   node inline-pages.mjs <origin as built> <origin inlined> [--storage <state.json>] <path>...
import { brotliCompressSync } from "node:zlib";
import { chromium } from "playwright-core";

const RUNS = 15;
const THROTTLING = [1, 4];
const args = process.argv.slice(2);
const storageAt = args.indexOf("--storage");
const storageState = storageAt < 0 ? undefined : args[storageAt + 1];
const [built, inlined, ...paths] = args.filter(
	(_, index) =>
		storageAt < 0 || (index !== storageAt && index !== storageAt + 1),
);
const servers = { "as built": built, "text inlined": inlined };

// SvelteKit's boot script starts the app with `kit.start(app, …)`, whose promise settles once the
// page is hydrated; the document is served with that promise handed to the page's clock.
const BOOT = "kit.start(app, ";
const watchHydration = () => {
	Object.defineProperty(window, "__graiHydration", {
		set(started) {
			started.then(() => {
				window.__graiHydrated = performance.now();
			});
		},
	});
};

/**
 * The document's elements, attributes, text and comments (Svelte's hydration markers) as a list, so
 * two pages compare exactly. Scripts, styles and links to the build's assets are left out.
 */
const pageText = () => {
	const left = ["SCRIPT", "LINK", "STYLE", "NOSCRIPT", "TEMPLATE"];
	const items = [];
	let text = "";
	const flush = () => {
		if (text !== "") items.push(JSON.stringify(text));
		text = "";
	};
	const walk = (node) => {
		for (const child of node.childNodes) {
			if (child.nodeType === Node.TEXT_NODE) text += child.data;
			if (child.nodeType === Node.COMMENT_NODE) {
				flush();
				items.push(`<!--${child.data}-->`);
			}
			if (child.nodeType !== Node.ELEMENT_NODE || left.includes(child.tagName))
				continue;
			flush();
			const attributes = [...child.attributes]
				.filter((a) => a.name !== "nonce" && !a.value.includes("/_app/"))
				.map((a) => `${a.name}=${JSON.stringify(a.value)}`)
				.sort();
			items.push(`<${child.localName} ${attributes.join(" ")}>`);
			walk(child);
			flush();
			items.push(`</${child.localName}>`);
		}
	};
	walk(document.documentElement);
	flush();
	return items;
};

async function open(browser, url, { rate = 1, javaScript = true } = {}) {
	const context = await browser.newContext({
		storageState,
		javaScriptEnabled: javaScript,
	});
	const page = await context.newPage();
	const cdp = await context.newCDPSession(page);
	await cdp.send("Emulation.setCPUThrottlingRate", { rate });
	await page.addInitScript(watchHydration);
	let booted = false;
	await page.route(
		(requested) => requested.href === url,
		async (route) => {
			const response = await route.fetch();
			const body = await response.text();
			booted = body.includes(BOOT);
			await route.fulfill({
				response,
				body: body.replace(BOOT, `window.__graiHydration = ${BOOT}`),
			});
		},
	);
	const scripts = [];
	page.on("response", (response) => {
		if (response.url().endsWith(".js")) scripts.push(response);
	});
	await page.goto(url);
	if (!booted) throw new Error(`${url} has no SvelteKit boot script`);
	if (javaScript) await page.waitForFunction(() => window.__graiHydrated);
	return { context, page, scripts: [...scripts] };
}

/** The page's text as served, then as hydrated, and the brotli bytes of the JS it loads until then. */
async function inspect(browser, url) {
	const served = await open(browser, url, { javaScript: false });
	const before = await served.page.evaluate(pageText);
	await served.context.close();
	const { context, page, scripts } = await open(browser, url);
	const after = await page.evaluate(pageText);
	let js = 0;
	for (const script of scripts)
		js += brotliCompressSync(await script.body()).length;
	await context.close();
	return { before, after, js };
}

/** Where two lists first differ, with the items around it, or undefined when they are the same. */
function difference(a, b) {
	const at = a.findIndex((item, index) => item !== b[index]);
	if (at < 0 && a.length === b.length) return undefined;
	const index = at < 0 ? Math.min(a.length, b.length) : at;
	const around = (list) => list.slice(Math.max(0, index - 3), index + 3);
	return `item ${index}: ${JSON.stringify(around(a))} against ${JSON.stringify(around(b))}`;
}

async function timedLoad(browser, url, rate) {
	const { context, page } = await open(browser, url, { rate });
	const result = await page.evaluate(() => {
		const [navigation] = performance.getEntriesByType("navigation");
		return {
			hydrated: window.__graiHydrated,
			client: window.__graiHydrated - navigation.responseEnd,
		};
	});
	await context.close();
	return result;
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const browser = await chromium.launch();
const inspected = new Map();
for (const path of paths) {
	const pages = {};
	for (const [name, origin] of Object.entries(servers))
		pages[name] = await inspect(browser, new URL(path, origin).href);
	const [plain, text] = Object.values(pages);
	const differs =
		difference(plain.before, text.before) ??
		difference(plain.after, text.after);
	if (differs !== undefined)
		throw new Error(`${path}: the inlined page's text differs, ${differs}`);
	inspected.set(path, pages);
}

console.log(
	`\n### ${paths.length} pages in Chromium ${browser.version()}, median of ${RUNS} loads, ms; the text of each is identical in both builds\n`,
);
console.log(
	"| page | build | CPU slowdown | JS KB brotli | hydrated at | after the document arrived |",
);
console.log("|---|---|---|---|---|---|");
for (const rate of THROTTLING) {
	const samples = new Map();
	for (let run = 0; run < RUNS; run++)
		for (const path of paths)
			for (const [name, origin] of Object.entries(servers)) {
				const key = `${path} ${name}`;
				if (!samples.has(key)) samples.set(key, []);
				samples
					.get(key)
					.push(await timedLoad(browser, new URL(path, origin).href, rate));
			}
	for (const path of paths)
		for (const name of Object.keys(servers)) {
			const runs = samples.get(`${path} ${name}`);
			const cell = (pick) => median(runs.map(pick)).toFixed(1);
			const js = (inspected.get(path)[name].js / 1024).toFixed(1);
			console.log(
				`| ${path} | ${name} | ${rate}× | ${js} | ${cell((r) => r.hydrated)} | ${cell((r) => r.client)} |`,
			);
		}
}
await browser.close();
