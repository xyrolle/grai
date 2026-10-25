// Real pages of a SvelteKit app, served side by side by builds that draw its messages in different
// ways (inline-build.mjs builds them). Each page is first compared exactly with the first build's:
// its text, whitespace included, its elements and their attributes, as the server draws it and as
// hydration leaves it. Beside that, each build reports whether its server drew the first build's
// hydration markers, and how many of the server's elements hydration kept: Svelte draws again
// what it cannot hydrate. Then each page is loaded in Chromium until SvelteKit has hydrated it, at
// full speed and at a 4× slowdown, each load in a fresh context and alternating between the
// builds, and the JS it loads until then is weighed. Pages behind a sign-in take a Playwright
// storage state.
//   node inline-pages.mjs [--storage <state.json>] <name>=<origin>... <path>...
import { brotliCompressSync } from "node:zlib";
import { chromium } from "playwright-core";

const RUNS = 15;
const THROTTLING = [1, 4];

const args = process.argv.slice(2);
const storageAt = args.indexOf("--storage");
const storageState = storageAt < 0 ? undefined : args[storageAt + 1];
const servers = new Map(
	args
		.filter((arg) => arg.includes("=") && arg.includes("://"))
		.map((arg) => [
			arg.slice(0, arg.indexOf("=")),
			arg.slice(arg.indexOf("=") + 1),
		]),
);
const paths = args.filter(
	(arg, index) => arg.startsWith("/") && index !== storageAt + 1,
);

// SvelteKit's boot script starts the app with `kit.start(app, …)`, whose promise settles once the
// page is hydrated. The document is served with that promise handed to the page, which notes the
// time and the server's elements as SvelteKit starts, and the time once it has hydrated.
const BOOT = "kit.start(app, ";
const watchHydration = () => {
	Object.defineProperty(window, "__graiHydration", {
		set(started) {
			window.__graiStarted = performance.now();
			window.__graiServed = [...document.body.querySelectorAll("*")];
			started.then(() => {
				window.__graiHydrated = performance.now();
			});
		},
	});
};

/**
 * The document's elements, their attributes and its text, and apart its comments, the markers. The
 * attributes that hold an element's id or name one are left out: a framework numbers the ids it
 * makes in the order it renders, which a build may change.
 */
const pageText = () => {
	const left = ["SCRIPT", "LINK", "STYLE", "NOSCRIPT", "TEMPLATE"];
	const ids = [
		"id",
		"for",
		"form",
		"list",
		"headers",
		"popovertarget",
		"aria-activedescendant",
		"aria-controls",
		"aria-describedby",
		"aria-details",
		"aria-errormessage",
		"aria-flowto",
		"aria-labelledby",
		"aria-owns",
	];
	const items = [];
	const markers = [];
	let text = "";
	const flush = () => {
		if (text !== "") items.push(JSON.stringify(text));
		text = "";
	};
	const walk = (node) => {
		for (const child of node.childNodes) {
			if (child.nodeType === Node.TEXT_NODE) text += child.data;
			if (child.nodeType === Node.COMMENT_NODE) markers.push(child.data);
			if (child.nodeType !== Node.ELEMENT_NODE || left.includes(child.tagName))
				continue;
			flush();
			const attributes = [...child.attributes]
				.filter(
					(a) =>
						a.name !== "nonce" &&
						!ids.includes(a.name) &&
						!a.value.includes("/_app/"),
				)
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
	return { items, markers: markers.join("|") };
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

/** The page as served and as hydrated, the server's elements hydration kept, and its JS. */
async function inspect(browser, url) {
	const served = await open(browser, url, { javaScript: false });
	const before = await served.page.evaluate(pageText);
	await served.context.close();
	const { context, page, scripts } = await open(browser, url);
	const after = await page.evaluate(pageText);
	const kept = await page.evaluate(() => {
		const served = window.__graiServed;
		return `${served.filter((element) => element.isConnected).length} of ${served.length}`;
	});
	let js = 0;
	for (const script of scripts)
		js += brotliCompressSync(await script.body()).length;
	await context.close();
	return { before, after, kept, js };
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
	const times = await page.evaluate(() => ({
		at: window.__graiHydrated,
		in: window.__graiHydrated - window.__graiStarted,
	}));
	await context.close();
	return times;
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const browser = await chromium.launch();
const [first] = servers.keys();
console.log(`\n### ${paths.length} pages in Chromium ${browser.version()}\n`);
console.log(
	`| page | build | JS KB brotli | server elements hydration kept | text as ${first}'s, served / hydrated | markers as ${first}'s |`,
);
console.log("|---|---|---|---|---|---|");
for (const path of paths) {
	const pages = new Map();
	for (const [name, origin] of servers)
		pages.set(name, await inspect(browser, new URL(path, origin).href));
	const reference = pages.get(first);
	for (const [name, page] of pages) {
		const same = (stage) => {
			const differs = difference(reference[stage].items, page[stage].items);
			if (differs === undefined) return "yes";
			console.error(`${path}, ${name}, ${stage}: ${differs}`);
			return "no";
		};
		const markers =
			page.before.markers === reference.before.markers ? "yes" : "no";
		console.log(
			`| ${path} | ${name} | ${(page.js / 1024).toFixed(1)} | ${page.kept} | ${same("before")} / ${same("after")} | ${markers} |`,
		);
	}
}

console.log(
	`\nUntil SvelteKit has hydrated the page, median of ${RUNS} loads, ms:\n`,
);
console.log(
	"| page | build | CPU slowdown | hydrated at | from SvelteKit's start |",
);
console.log("|---|---|---|---|---|");
for (const rate of THROTTLING) {
	const samples = new Map();
	for (let run = 0; run < RUNS; run++)
		for (const path of paths)
			for (const [name, origin] of servers) {
				const key = `${path} ${name}`;
				if (!samples.has(key)) samples.set(key, []);
				samples
					.get(key)
					.push(await timedLoad(browser, new URL(path, origin).href, rate));
			}
	for (const path of paths)
		for (const name of servers.keys()) {
			const runs = samples.get(`${path} ${name}`);
			const cell = (pick) => median(runs.map(pick)).toFixed(1);
			console.log(
				`| ${path} | ${name} | ${rate}× | ${cell((r) => r.at)} | ${cell((r) => r.in)} |`,
			);
		}
}
await browser.close();
