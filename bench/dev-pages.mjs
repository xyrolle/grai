// The dev pages the dev benches serve, one per design: a page of 500 messages of a locale in
// Vite's dev server, its catalogs, and the plugins that serve them. "grai's plugin" is grai's own
// Vite plugin, as an app runs it; "whole", "patch" and "patch, fs.watch" are the designs it was
// chosen from (hmr.mjs); "paraglide" is Paraglide's own Vite plugin; "i18next" and "use-intl"
// import the locale's JSON; "no messages" draws the keys' names.
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
import { graiSource } from "./grai.mjs";
import { libraryCatalogs } from "./libraries.mjs";
import { writeProject } from "./paraglide.mjs";
import { messageFunction, pluralRuleOf } from "./prototype.mjs";

const { grai } = await import(join(graiSource, "vite.ts"));
// The dev server comes from the Vite grai's source imports, as an app has one Vite: grai's plugin
// tells a server environment it can patch in place by Vite's own class, and the bench's copy of
// Vite is another, so a server made by it would have its messages taken again on every edit.
export const { createServer } = await import(
	join(graiSource, "../node_modules/vite/dist/node/index.js")
);

const SHOWN = 500;

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
export function writeFixture(root, app, locale, design) {
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
export function pluginsFor(design, app, root, locale, timings) {
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
