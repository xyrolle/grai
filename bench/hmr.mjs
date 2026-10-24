// Dev: one message edited until the page shows it, end to end in Vite: the catalog written, the
// watcher, the plugin, the socket, the browser, the DOM. Every design serves the same module, every
// locale of every key in one table. "whole" lets Vite re-send and re-evaluate it on each edit;
// "patch" sends a custom HMR event naming a module of only the changed functions, which the page
// imports and writes into the table; "patch, fs.watch" does the same from its own watcher on the
// catalogs instead of Vite's. The edits go to a copy of the catalogs under .cache, never the app's.
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
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { cacheDir, selectedApps } from "./apps.mjs";
import { messageFunction, pluralRuleOf } from "./prototype.mjs";
import { otherLocale } from "./request.mjs";

const PORT = 4747;
const EDITS = 20;
const SHOWN = 500;
const SAVE_INTERVAL_MS = 500;

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

function writeFixture(root, app, locale) {
	rmSync(root, { recursive: true, force: true });
	mkdirSync(join(root, "messages"), { recursive: true });
	for (const each of app.locales)
		cpSync(app.catalogs[each], join(root, "messages", `${each}.json`));
	const plain = (key) =>
		app.locales.every(
			(each) =>
				typeof app.messages[each][key] === "string" &&
				!app.messages[each][key].includes("{"),
		);
	const shown = Object.keys(app.messages[locale]).filter(plain).slice(0, SHOWN);
	writeFileSync(
		join(root, "index.html"),
		`<!doctype html><meta charset="utf-8"><p id="target"></p><ul id="list"></ul><script type="module" src="/main.js"></script>`,
	);
	writeFileSync(
		join(root, "main.js"),
		`import * as messages from "virtual:messages";
const shown = ${JSON.stringify(shown)};
function render(m) {
	m.setLocale(${JSON.stringify(locale)});
	document.getElementById("target").textContent = m[shown[0]]();
	const list = document.getElementById("list");
	list.replaceChildren(...shown.slice(1).map((key) => Object.assign(document.createElement("li"), { textContent: m[key]() })));
}
render(messages);
addEventListener("grai:change", () => render(messages));
if (import.meta.hot) import.meta.hot.accept("virtual:messages", (next) => render(next));
new MutationObserver(() => { window.changed = { at: performance.timeOrigin + performance.now(), text: document.getElementById("target").textContent }; })
	.observe(document.getElementById("target"), { childList: true, characterData: true, subtree: true });
window.ready = true;
`,
	);
	return shown[0];
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function measure(browser, app, design) {
	const locale = otherLocale(app);
	const root = join(cacheDir, "hmr", app.id);
	const key = writeFixture(root, app, locale);
	const timings = { edits: [] };
	const server = await createServer({
		root,
		configFile: false,
		logLevel: "silent",
		server: { port: PORT, strictPort: true },
		plugins: [devPlugin(root, app.locales, design, timings)],
	});
	await server.listen();
	const page = await browser.newPage();
	page.on("pageerror", (error) => console.error("page error:", error.message));
	const loadStart = performance.now();
	await page.goto(`http://localhost:${PORT}/`);
	await page.waitForFunction(() => window.ready);
	const load = performance.now() - loadStart;

	const catalogFile = join(root, "messages", `${locale}.json`);
	const catalog = JSON.parse(readFileSync(catalogFile, "utf8"));
	const original = catalog[key];
	const latencies = [];
	for (let edit = 0; edit < EDITS + 3; edit++) {
		// Saves come seconds apart; back-to-back writes would measure the file watcher's coalescing.
		await new Promise((resolve) => setTimeout(resolve, SAVE_INTERVAL_MS));
		catalog[key] = `Edit ${edit}: ${original}`;
		const written = performance.timeOrigin + performance.now();
		writeFileSync(catalogFile, JSON.stringify(catalog, null, "\t"));
		const changed = await page
			.waitForFunction(
				(text) => window.changed?.text === text && window.changed,
				catalog[key],
				{ timeout: 30_000 },
			)
			.then((handle) => handle.jsonValue());
		const reached = timings.edits.at(-1);
		if (edit >= 3)
			latencies.push({
				total: changed.at - written,
				watcher: reached.reached - written,
				plugin: reached.answered - reached.reached,
				browser: changed.at - reached.answered,
			});
	}
	await page.close();
	await server.close();
	rmSync(root, { recursive: true, force: true });
	const cell = (field) =>
		median(latencies.map((latency) => latency[field])).toFixed(1);
	console.log(
		`| ${design} | ${(timings.generate.bytes / 1024 / 1024).toFixed(1)} MB, ${timings.generate.ms.toFixed(0)} ms | ${load.toFixed(0)} | ${cell("total")} | ${cell("watcher")} | ${cell("plugin")} | ${cell("browser")} |`,
	);
}

const browser = await chromium.launch();
for (const app of selectedApps()) {
	console.log(
		`\n### ${app.name}: one message edited until the page shows it, Vite dev, Chromium ${browser.version()}, median of ${EDITS} edits, ms\n`,
	);
	console.log(
		"| design | dev module, generated in | page load | edit to page | watcher | plugin | browser |",
	);
	console.log("|---|---|---|---|---|---|---|");
	for (const design of ["whole", "patch", "patch, fs.watch"])
		await measure(browser, app, design);
}
await browser.close();
