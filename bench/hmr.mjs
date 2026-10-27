// Dev: one message edited until the page shows it, end to end in Vite: the catalog written, the
// watcher, the plugin, the socket, the browser, the DOM. "grai" is grai's own Vite plugin, as an
// app runs it, and it also times the edit until a server render through Vite's module runner
// shows it. The designs it was chosen from follow, as experiments: each serves the same module,
// every locale of every key in one table, from a compiler of this bench's own (prototype.mjs).
// "whole" lets Vite re-send and re-evaluate it on each edit; "patch" sends a custom HMR event
// naming a module of only the changed functions, which the page imports and writes into the
// table; "patch, fs.watch" does the same from its own watcher on the catalogs instead of Vite's.
// Beside them: Paraglide's own Vite plugin, which compiles again on an edit, and i18next and
// use-intl, whose page imports the locale's JSON and accepts its update. Each page's heap, once
// collected, is taken at load and after the edits, and against the same page with no messages
// grai's plugin has a budget for it (HEAP_BUDGET). The edits go to a copy of the catalogs under
// .cache, never the app's.
//   node hmr.mjs [app...]
import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	watch,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { paraglideVitePlugin } from "@inlang/paraglide-js";
import { chromium } from "playwright-core";
import { cacheDir, selectedApps } from "./apps.mjs";
import { graiSource } from "./grai.mjs";
import { libraryCatalogs } from "./libraries.mjs";
import { writeProject } from "./paraglide.mjs";
import { messageFunction, pluralRuleOf } from "./prototype.mjs";
import { otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";

const { grai } = await import(join(graiSource, "vite.ts"));
// The dev server comes from the Vite grai's source imports, as an app has one Vite: grai's plugin
// tells a server environment it can patch in place by Vite's own class, and the bench's copy of
// Vite is another, so a server made by it would have its messages taken again on every edit.
const { createServer } = await import(
	join(graiSource, "../node_modules/vite/dist/node/index.js")
);

const EDITS = 20;
const SHOWN = 500;
const SAVE_INTERVAL_MS = 500;
/**
 * What grai's dev page may keep once collected, over the same page with no messages: bytes per
 * message, a key in one locale, at load, and bytes per edit after the edits. Its table holds every
 * locale of every key, and each call goes through a function a patch reaches: 351–361 B a message
 * on catalogs of 6,366 to 13,326 keys in three locales, and 5.2–5.8 KB more an edit.
 */
const HEAP_BUDGET = { message: 400, edit: 8 * 1024 };

/** The dev module: every key a row of per-locale functions, read through the current locale. */
function devModule(locales, catalogs, patchable) {
	const keys = Object.keys(catalogs[locales[0]]);
	const rule = (locale) => `plural_${locale.replace(/\W/g, "_")}`;
	const lines = [
		...locales.map(
			(locale) => `const ${rule(locale)} = ${pluralRuleOf(locale)};`,
		),
		`export const locales = ${JSON.stringify(locales)};`,
		`let current = 0;`,
		`export const setLocale = (locale) => { current = locales.indexOf(locale); };`,
		`export const T = {`,
		...keys.map(
			(key) =>
				`\t${key}: [${locales.map((locale) => messageFunction(key, catalogs[locale][key], rule(locale))).join(", ")}],`,
		),
		`};`,
		...keys.map((key) => `export const ${key} = (i) => T.${key}[current](i);`),
	];
	if (patchable) {
		lines.push(`if (import.meta.hot) import.meta.hot.on("grai:update", async ({ url }) => {
	const { patches } = await import(/* @vite-ignore */ url);
	for (const [key, index, message] of patches) T[key][index] = message;
	dispatchEvent(new Event("grai:change"));
});`);
	}
	return `${lines.join("\n")}\n`;
}

/**
 * The plugin for one design: "whole" lets Vite re-send the module, "patch" sends the changed keys'
 * functions from Vite's own file watcher, "patch, fs.watch" from a watcher of its own on the
 * catalogs. `timings` collects when each edit reached the plugin and when it answered.
 */
function devPlugin(root, locales, design, timings) {
	const catalogPath = (locale) => join(root, "messages", `${locale}.json`);
	const read = (locale) => {
		const { $schema, ...catalog } = JSON.parse(
			readFileSync(catalogPath(locale), "utf8"),
		);
		return catalog;
	};
	const catalogs = Object.fromEntries(
		locales.map((locale) => [locale, read(locale)]),
	);
	const patchModules = new Map();
	const watchers = [];

	/** Sends the edit's changed functions as a patch module; returns false while the file is mid-write. */
	function sendPatch(hot, locale, reached) {
		let next;
		try {
			next = read(locale);
		} catch (error) {
			// A watcher can fire while the file is still being written; the write's last event follows.
			if (error instanceof SyntaxError) return false;
			throw error;
		}
		const changed = Object.keys(next).filter(
			(key) =>
				JSON.stringify(next[key]) !== JSON.stringify(catalogs[locale][key]),
		);
		catalogs[locale] = next;
		if (changed.length === 0) return true;
		const index = locales.indexOf(locale);
		const patches = changed.map(
			(key) =>
				`[${JSON.stringify(key)}, ${index}, ${messageFunction(key, next[key], "plural")}]`,
		);
		const url = `/@grai/patch/${patchModules.size}.js`;
		patchModules.set(
			url,
			`const plural = ${pluralRuleOf(locale)};\nexport const patches = [${patches.join(", ")}];\n`,
		);
		hot.send({ type: "custom", event: "grai:update", data: { url } });
		timings.edits.push({
			reached,
			answered: performance.timeOrigin + performance.now(),
		});
		return true;
	}

	return {
		name: "grai-dev",
		resolveId: (id) =>
			id === "virtual:messages" ? "\0virtual:messages" : null,
		load(id) {
			if (id !== "\0virtual:messages") return null;
			const start = performance.now();
			const code = devModule(locales, catalogs, design !== "whole");
			timings.generate = {
				ms: performance.now() - start,
				bytes: Buffer.byteLength(code),
			};
			return code;
		},
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				// Vite's client marks a dynamic import with ?import.
				const code = patchModules.get(request.url.split("?")[0]);
				if (!code) return next();
				response.setHeader("content-type", "text/javascript");
				response.end(code);
			});
			if (design !== "patch, fs.watch") return;
			for (const locale of locales) {
				watchers.push(
					watch(catalogPath(locale), () =>
						sendPatch(
							server.environments.client.hot,
							locale,
							performance.timeOrigin + performance.now(),
						),
					),
				);
			}
			server.httpServer?.once("close", () => {
				for (const watcher of watchers) watcher.close();
			});
		},
		hotUpdate({ file }) {
			const locale = locales.find(
				(candidate) => catalogPath(candidate) === file,
			);
			if (!locale || this.environment.name !== "client") return;
			if (design === "patch, fs.watch") return [];
			const reached = performance.timeOrigin + performance.now();
			if (design === "patch") {
				sendPatch(this.environment.hot, locale, reached);
				return [];
			}
			catalogs[locale] = read(locale);
			const module =
				this.environment.moduleGraph.getModuleById("\0virtual:messages");
			this.environment.moduleGraph.invalidateModule(module);
			timings.edits.push({
				reached,
				answered: performance.timeOrigin + performance.now(),
			});
			return [module];
		},
	};
}

/** For the libraries: when the edited catalog's update reaches the plugins. */
function timingPlugin(catalogFile, timings) {
	return {
		name: "edit-timing",
		hotUpdate({ file }) {
			if (file !== catalogFile || this.environment.name !== "client") return;
			const reached = performance.timeOrigin + performance.now();
			timings.edits.push({ reached, answered: reached });
		},
	};
}

/** The page's module per design: it renders 500 messages and renders them again on an update. */
function pageModule(design, locale, shown) {
	const lang = JSON.stringify(locale);
	const render = (call) => `function render() {
	document.getElementById("target").textContent = ${call("shown[0]")};
	const list = document.getElementById("list");
	list.replaceChildren(...shown.slice(1).map((key) => Object.assign(document.createElement("li"), { textContent: ${call("key")} })));
}
render();`;
	const accept = (specifier, update) =>
		`if (import.meta.hot) import.meta.hot.accept(${JSON.stringify(specifier)}, (next) => { ${update}; render(); });`;
	const pages = {
		// Vite's client and the page alone, which draws the keys' names.
		"no messages": render((key) => key),
		// grai's plugin dispatches grai:change on window after an edit; the page draws again and
		// cancels it, as a framework's adapter does, or the page would reload.
		"grai's plugin": `import { m } from "./out/messages.js";
${render((key) => `m[${key}]()`)}
addEventListener("grai:change", (event) => { event.preventDefault(); render(); });`,
		grai: `import * as messages from "virtual:messages";
let m = messages;
m.setLocale(${lang});
${render((key) => `m[${key}]()`)}
addEventListener("grai:change", render);
${accept("virtual:messages", `m = next; m.setLocale(${lang})`)}`,
		paraglide: `import * as messages from "./paraglide/messages.js";
let m = messages.m;
const options = { locale: ${lang} };
${render((key) => `m[${key}]({}, options)`)}
${accept("./paraglide/messages.js", "m = next.m")}`,
		i18next: `import i18next from "i18next";
import translation from "./messages/${locale}.json";
const instance = i18next.createInstance();
instance.init({ lng: ${lang}, resources: { ${lang}: { translation } }, initAsync: false, interpolation: { escapeValue: false } });
${render((key) => `instance.t(${key})`)}
${accept(`./messages/${locale}.json`, `instance.addResourceBundle(${lang}, "translation", next.default, true, true)`)}`,
		"use-intl": `import { createTranslator } from "use-intl/core";
import messages from "./messages/${locale}.json";
let t = createTranslator({ locale: ${lang}, messages });
${render((key) => `t(${key})`)}
${accept(`./messages/${locale}.json`, `t = createTranslator({ locale: ${lang}, messages: next.default })`)}`,
	};
	return `const shown = ${JSON.stringify(shown)};
${pages[design] ?? pages.grai}
new MutationObserver(() => { window.changed = { at: performance.timeOrigin + performance.now(), text: document.getElementById("target").textContent }; })
	.observe(document.getElementById("target"), { childList: true, characterData: true, subtree: true });
window.ready = true;
`;
}

/**
 * The page and its catalogs: 500 messages of the locale, the first one the edited target. i18next
 * and use-intl edit their own format of the locale's catalog, which the page imports as JSON.
 */
function writeFixture(root, app, locale, design) {
	rmSync(root, { recursive: true, force: true });
	mkdirSync(join(root, "messages"), { recursive: true });
	for (const each of app.locales)
		cpSync(app.catalogs[each], join(root, "messages", `${each}.json`));
	const converted = { i18next: "i18next", "use-intl": "icu" }[design];
	if (converted)
		writeFileSync(
			join(root, "messages", `${locale}.json`),
			JSON.stringify(libraryCatalogs(app, locale)[converted], null, "\t"),
		);
	const plain = (key) =>
		app.locales.every(
			(each) =>
				typeof app.messages[each][key] === "string" &&
				!app.messages[each][key].includes("{"),
		);
	const shown = Object.keys(app.messages[locale]).filter(plain).slice(0, SHOWN);
	writeFileSync(
		join(root, "index.html"),
		`<!doctype html><html lang="${locale}"><meta charset="utf-8"><p id="target"></p><ul id="list"></ul><script type="module" src="/main.js"></script>`,
	);
	if (design === "grai's plugin") {
		writeFileSync(
			join(root, "grai.config.json"),
			JSON.stringify({
				locales: app.locales,
				baseLocale: app.baseLocale,
				catalogs: "messages/{locale}.json",
				outdir: "out",
			}),
		);
		writeFileSync(
			join(root, "render.js"),
			`import { m } from "./out/messages.js";\nexport const render = (key, locale) => m[key]({}, { locale });\n`,
		);
	}
	writeFileSync(join(root, "main.js"), pageModule(design, locale, shown));
	return shown[0];
}

/** The design's plugins: grai's dev plugin, or Paraglide's Vite plugin, or none but the timing. */
function pluginsFor(design, app, root, locale, timings) {
	const catalogFile = join(root, "messages", `${locale}.json`);
	if (design === "paraglide") {
		const catalogs = Object.fromEntries(
			app.locales.map((each) => [each, join(root, "messages", `${each}.json`)]),
		);
		const project = writeProject({ ...app, catalogs }, root);
		return [
			paraglideVitePlugin({
				project,
				outdir: join(root, "paraglide"),
				outputStructure: "locale-modules",
				strategy: app.compilerOptions.strategy,
			}),
			timingPlugin(catalogFile, timings),
		];
	}
	if (design === "no messages") return [];
	if (design === "i18next" || design === "use-intl")
		return [timingPlugin(catalogFile, timings)];
	if (design === "grai's plugin")
		return [grai({ config: join(root, "grai.config.json") })];
	return [devPlugin(root, app.locales, design, timings)];
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure(browser, app, design) {
	const locale = otherLocale(app);
	const root = join(cacheDir, "hmr", app.id);
	const key = writeFixture(root, app, locale, design);
	const timings = { edits: [] };
	const server = await createServer({
		root,
		configFile: false,
		logLevel: "silent",
		// A port the system picks, so that runs side by side never meet.
		server: {
			host: "127.0.0.1",
			port: 0,
			watch: { ignored: ["**/render.js", "**/main.js", "**/index.html"] },
		},
		plugins: pluginsFor(design, app, root, locale, timings),
	});
	await server.listen();
	const page = await browser.newPage();
	page.on("pageerror", (error) => console.error("page error:", error.message));
	const loadStart = performance.now();
	await page.goto(server.resolvedUrls.local[0]);
	await page.waitForFunction(() => window.ready);
	const load = performance.now() - loadStart;
	// What the page keeps, its messages among it: V8's heap once a full collection has run.
	const cdp = await page.context().newCDPSession(page);
	const retained = async () => {
		await cdp.send("HeapProfiler.collectGarbage");
		return (await cdp.send("Runtime.getHeapUsage")).usedSize;
	};
	const heap = { load: await retained() };

	const catalogFile = join(root, "messages", `${locale}.json`);
	const catalogBytes = readFileSync(catalogFile).length;
	// grai's: when a server render through Vite's runner shows the edit, polled each millisecond,
	// for as long as the page is waited for.
	const ssr = server.environments.ssr;
	const rendered = async (text) => {
		const until = performance.now() + 120_000;
		for (;;) {
			const { render } = await ssr.runner.import("/render.js");
			const shown = render(key, locale);
			if (shown === text) return performance.timeOrigin + performance.now();
			if (performance.now() > until)
				throw new Error(
					`a server render still showed ${JSON.stringify(shown)} 120 s after the edit to ${JSON.stringify(text)}`,
				);
			await new Promise((resolve) => setTimeout(resolve, 1));
		}
	};
	const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
	const original = catalog[key];
	// The server's program evaluated before the first edit, as a dev server has it, so the first edit
	// times a patch, not the program's first evaluation.
	if (design === "grai's plugin") await rendered(original);
	const latencies = [];
	const edits = design === "no messages" ? 0 : EDITS + 3;
	for (let edit = 0; edit < edits; edit++) {
		// Saves come seconds apart; back-to-back writes would measure the file watcher's coalescing.
		await new Promise((resolve) => setTimeout(resolve, SAVE_INTERVAL_MS));
		catalog[key] = `Edit ${edit}: ${original}`;
		const written = performance.timeOrigin + performance.now();
		writeFileSync(catalogFile, JSON.stringify(catalog, null, "\t"));
		const [changed, serverAt] = await Promise.all([
			page
				.waitForFunction(
					(text) => window.changed?.text === text && window.changed,
					catalog[key],
					{ timeout: 120_000 },
				)
				.then((handle) => handle.jsonValue()),
			design === "grai's plugin" ? rendered(catalog[key]) : undefined,
		]);
		const reached = timings.edits.at(-1);
		if (edit >= 3)
			latencies.push({
				total: changed.at - written,
				server: serverAt === undefined ? undefined : serverAt - written,
				watcher: reached && reached.reached - written,
				plugin: reached && reached.answered - reached.reached,
				browser: reached && changed.at - reached.answered,
			});
	}
	heap.edits = await retained();
	await page.close();
	await server.close();
	rmSync(root, { recursive: true, force: true });
	const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
	const served =
		design === "no messages"
			? "—"
			: timings.generate
				? `${megabytes(timings.generate.bytes)}, ${timings.generate.ms.toFixed(0)} ms`
				: `${megabytes(catalogBytes)} catalog`;
	const cell = (field) =>
		latencies[0]?.[field] === undefined
			? "—"
			: median(latencies.map((latency) => latency[field])).toFixed(1);
	const ms = (field) =>
		latencies[0]?.[field] === undefined
			? undefined
			: median(latencies.map((latency) => latency[field]));
	return {
		design,
		heap,
		measured: {
			design,
			pageLoad: load,
			editToPage: ms("total"),
			editToServer: ms("server"),
			heap,
		},
		row: `| ${design} | ${served} | ${load.toFixed(0)} | ${cell("total")} | ${cell("server")} | ${cell("watcher")} | ${cell("plugin")} | ${cell("browser")} | ${megabytes(heap.load)} | ${megabytes(heap.edits)} |`,
	};
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
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
	// Paraglide's plugin logs each compile, so the table is printed once every design has run.
	const results = [];
	for (const design of designs)
		results.push(await measure(browser, app, design));
	console.log(
		`\n### ${app.name}: one message edited until the page shows it, Vite dev, Chromium ${browser.version()}, median of ${EDITS} edits, ms; the page's heap once collected\n`,
	);
	console.log(
		"| design | dev module, generated in | page load | edit to page | edit to server render | watcher | plugin | browser | heap at load | heap after the edits |",
	);
	console.log("|---|---|---|---|---|---|---|---|---|---|");
	for (const { row } of results) console.log(row);
	recordResults(
		`hmr-${app.id}`,
		results.map(({ measured }) => measured),
		{ app: app.name, edits: EDITS, chromium: browser.version() },
	);
	const heapOf = (design) =>
		results.find((result) => result.design === design).heap;
	const grai = heapOf("grai's plugin");
	const none = heapOf("no messages");
	const messages =
		app.locales.length * Object.keys(app.messages[app.baseLocale]).length;
	const perMessage = (grai.load - none.load) / messages;
	const perEdit = (grai.edits - grai.load) / (EDITS + 3);
	const over = perMessage > HEAP_BUDGET.message || perEdit > HEAP_BUDGET.edit;
	console.log(
		`\ngrai's plugin keeps ${perMessage.toFixed(0)} B a message over the page with no messages (budget ${HEAP_BUDGET.message} B), and ${(perEdit / 1024).toFixed(1)} KB more an edit (budget ${HEAP_BUDGET.edit / 1024} KB)${over ? ": over budget" : ""}`,
	);
	if (over) process.exitCode = 1;
}
await browser.close();
