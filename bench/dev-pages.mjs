// The dev pages the dev benches serve, one per design: a page of 500 messages of a locale in
// Vite's dev server, its catalogs, and the plugins that serve them. "grai's plugin" is grai's own
// Vite plugin, as an app runs it; "whole", "patch" and "patch, fs.watch" are the designs it was
// chosen from (hmr.mjs); "paraglide" is Paraglide's own Vite plugin; "i18next" and "use-intl"
// import the locale's JSON; "no messages" draws the same texts from its own code.
import {
	cpSync,
	mkdirSync,
	readFileSync,
	rmSync,
	watch,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { sampleCalls, takesInputs } from "./calls.mjs";
import { graiEntry, graiVite } from "./grai.mjs";
import { i18nextValues, libraryCatalogs } from "./libraries.mjs";
import { paraglideOutput, writeProject } from "./paraglide.mjs";
import { messageFunction, pluralRuleOf } from "./prototype.mjs";

// The dev server comes from the Vite grai's build imports (`graiVite`), as an app has one Vite.
export const { createServer } = await import(graiVite);

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

/**
 * The page's module per design: it draws its calls' texts, the first into the target an edit
 * changes, and draws them again on an update. Once they are in the DOM, it sets `window.ready`,
 * and the time of that and of the frame drawn after it as `window.shown`, by the page's clock:
 * `ready`, then `painted` once a task queued from that frame's animation callback runs, after the
 * frame's style, layout and paint.
 */
function pageModule(design, locale, page) {
	const lang = JSON.stringify(locale);
	const calls = `const calls = ${JSON.stringify(page.calls)};`;
	const render = (list, text) => `function render() {
	const drawn = ${list}.map((c) => ${text});
	document.getElementById("target").textContent = drawn[0];
	const list = document.getElementById("list");
	list.replaceChildren(...drawn.slice(1).map((text) => Object.assign(document.createElement("li"), { textContent: text })));
}
render();`;
	const accept = (specifier, update) =>
		`if (import.meta.hot) import.meta.hot.accept(${JSON.stringify(specifier)}, (next) => { ${update}; render(); });`;
	const pages = {
		// Vite's client and the page alone, which draws the same texts from its own code.
		"no messages": `const texts = ${JSON.stringify(page.texts)};
${render("texts", "c")}`,
		// grai's plugin dispatches grai:change on window after an edit; the page draws again and
		// cancels it, as a framework's adapter does, or the page would reload.
		"grai's plugin": `import { m } from "./out/messages.js";
${calls}
${render("calls", "m[c.key](c.inputs)")}
addEventListener("grai:change", (event) => { event.preventDefault(); render(); });`,
		grai: `import * as messages from "virtual:messages";
let m = messages;
m.setLocale(${lang});
${calls}
${render("calls", "m[c.key](c.inputs)")}
addEventListener("grai:change", render);
${accept("virtual:messages", `m = next; m.setLocale(${lang})`)}`,
		paraglide: `import * as messages from "./paraglide/messages.js";
let m = messages.m;
const options = { locale: ${lang} };
${calls}
${render("calls", "m[c.key](c.inputs ?? {}, options)")}
${accept("./paraglide/messages.js", "m = next.m")}`,
		i18next: `import i18next from "i18next";
import translation from "./messages/${locale}.json";
const instance = i18next.createInstance();
instance.init({ lng: ${lang}, resources: { ${lang}: { translation } }, initAsync: false, interpolation: { escapeValue: false } });
${calls}
${render("calls", "instance.t(c.key, c.i18next)")}
${accept(`./messages/${locale}.json`, `instance.addResourceBundle(${lang}, "translation", next.default, true, true)`)}`,
		"use-intl": `import { createTranslator } from "use-intl/core";
import messages from "./messages/${locale}.json";
let t = createTranslator({ locale: ${lang}, messages });
${calls}
${render("calls", "t(c.key, c.inputs)")}
${accept(`./messages/${locale}.json`, `t = createTranslator({ locale: ${lang}, messages: next.default })`)}`,
	};
	return `${pages[design] ?? pages.grai}
new MutationObserver(() => { window.changed = { at: performance.timeOrigin + performance.now(), text: document.getElementById("target").textContent }; })
	.observe(document.getElementById("target"), { childList: true, characterData: true, subtree: true });
window.ready = true;
const ready = performance.timeOrigin + performance.now();
requestAnimationFrame(() => {
	const after = new MessageChannel();
	after.port1.onmessage = () => { window.shown = { ready, painted: performance.timeOrigin + performance.now() }; };
	after.port2.postMessage(null);
});
`;
}

/**
 * The page of plain texts: the first 500 keys whose message is plain text in every locale, which
 * the page calls without inputs, each text its catalog's own.
 */
export function textPage(app, locale) {
	const plain = (key) =>
		app.locales.every(
			(each) =>
				typeof app.messages[each][key] === "string" &&
				!app.messages[each][key].includes("{"),
		);
	const keys = Object.keys(app.messages[locale]).filter(plain).slice(0, SHOWN);
	return {
		calls: keys.map((key) => ({ key })),
		texts: keys.map((key) => app.messages[locale][key]),
	};
}

/**
 * The page of mixed calls: 500 in the catalog's own mix of texts, inputs, plurals and markup
 * (calls.mjs), each with its inputs, as i18next takes them too, and each text as Paraglide's
 * output draws it in Node.
 */
export async function mixedPage(app, locale) {
	const sample = sampleCalls(app, SHOWN);
	const { m } = await import(join(await paraglideOutput(app), "messages.js"));
	return {
		calls: sample.map((call) =>
			takesInputs(call)
				? {
						key: call.key,
						inputs: call.inputs,
						i18next: i18nextValues(app, call.key, call.inputs),
					}
				: { key: call.key },
		),
		texts: sample.map(({ key, inputs }) => m[key](inputs, { locale })),
	};
}

/**
 * The page and its catalogs: its calls in the locale, the first one the edited target, by default
 * the page of plain texts. i18next and use-intl edit their own format of the locale's catalog,
 * which the page imports as JSON. Returns the edited key.
 */
export function writeFixture(
	root,
	app,
	locale,
	design,
	page = textPage(app, locale),
) {
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
	if (design === "paraglide") {
		const catalogs = Object.fromEntries(
			app.locales.map((each) => [each, join(root, "messages", `${each}.json`)]),
		);
		writeProject({ ...app, catalogs }, root);
	}
	writeFileSync(join(root, "main.js"), pageModule(design, locale, page));
	return page.calls[0].key;
}

/** The designs grai's plugin was chosen from (hmr.mjs), each served by `devPlugin`. */
const prototypes = ["whole", "patch", "patch, fs.watch"];

/**
 * The design's plugins: grai's dev plugin, or Paraglide's Vite plugin, or none but the timing, or a
 * prototype's. A library's plugin is imported here, as an app's config imports it before its server
 * starts, so a start timed from this call counts it. A name that is none of the designs is refused,
 * rather than served as a prototype.
 */
export async function pluginsFor(design, app, root, locale, timings) {
	const catalogFile = join(root, "messages", `${locale}.json`);
	if (design === "paraglide") {
		const { paraglideVitePlugin } = await import("@inlang/paraglide-js");
		return [
			paraglideVitePlugin({
				project: join(root, "project.inlang"),
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
	if (design === "grai's plugin") {
		const { grai } = await import(graiEntry("./vite"));
		return [grai({ config: join(root, "grai.config.json") })];
	}
	if (prototypes.includes(design))
		return [devPlugin(root, app.locales, design, timings)];
	throw new Error(
		`${JSON.stringify(design)} is none of the dev pages' designs.`,
	);
}
