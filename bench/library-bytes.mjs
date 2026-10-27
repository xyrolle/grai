// What each library ships to the browser for one locale, KB brotli (raw): the runtime a page needs
// to show its messages, and its messages for the whole catalog.
//
// The runtime is what a library adds to a page that shows three messages, one of each kind every
// library has: a plain text, a text with an input and a plural. Each library's page is built as an
// app's client build makes it, with the library's own plugins (production.mjs), and loaded in
// Chromium, which checks that every page shows the same three texts. A page's JS is every script
// it loads, each compressed on its own, and those its index.html holds inline; the runtime is that
// JS less the same page's with the three texts written into it, so the three messages are in it.
// Beside it, as rows of their own, the modules this figure used to stand for, each bundled alone
// by Rolldown for the browser, as Vite sets a client build up: grai's and Paraglide's runtime
// modules with every export, i18next set up with `init` and `t`, and use-intl's
// `createTranslator`.
//
// The messages are the whole catalog in the locale. i18next and use-intl load a locale's whole
// catalog (or namespace) unless an app picks a page's keys; grai and Paraglide ship only the keys
// a page imports, which `bytes` measures per page. grai's are the locale's copies of the message
// chunks a Vite build with grai's plugin writes for a page that names every key. Beside them, the
// per-locale module the design started from, as prototype.mjs writes it.
//   node library-bytes.mjs [app...]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { chromium } from "playwright-core";
import { rolldown } from "rolldown";
import { build } from "vite";
import { cacheDir, selectedApps } from "./apps.mjs";
import { sampleCalls, takesInputs } from "./calls.mjs";
import { benchPage } from "./chromium.mjs";
import {
	graiEntry,
	graiModule,
	graiOutput,
	writeGraiProject,
} from "./grai.mjs";
import {
	i18nextValues,
	libraryCatalogs,
	writeLibraryModules,
} from "./libraries.mjs";
import { paraglideForVite } from "./paraglide.mjs";
import { clientBuild, PAGE_ENTRY, pluginsOf } from "./production.mjs";
import { writePrototype } from "./prototype.mjs";
import { otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";

const brotli = (code) =>
	brotliCompressSync(Buffer.from(code), {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
	}).length;

/** What Vite defines in a client build, which the libraries' own code reads. */
const clientDefines = {
	"import.meta.env.SSR": "false",
	"process.env.NODE_ENV": JSON.stringify("production"),
};

/** A minified browser bundle of `source`; `external` modules stay out of it. */
async function bundle(source, external = () => false) {
	const build = await rolldown({
		input: "entry",
		platform: "browser",
		external,
		transform: { define: clientDefines },
		plugins: [
			{
				name: "entry",
				resolveId: (id) => (id === "entry" ? id : null),
				load: (id) => (id === "entry" ? source : null),
			},
		],
		logLevel: "silent",
	});
	const { output } = await build.generate({ format: "esm", minify: true });
	await build.close();
	return output[0].code;
}

const { grai } = await import(graiEntry("./vite"));
const { localeDirectory } = await import(graiModule("message-directories.ts"));

/** The locale's copies of the message chunks a client build writes for a page naming every key. */
async function graiBuiltMessages(config, locale) {
	const root = dirname(config);
	const page = join(root, "page.js");
	writeFileSync(page, `export { m } from "./out/messages.js";\n`);
	const { output } = await build({
		root,
		configFile: false,
		logLevel: "silent",
		plugins: [grai({ config, localeChunks: true })],
		build: {
			write: false,
			rolldownOptions: { input: page, preserveEntrySignatures: "strict" },
		},
	});
	return output
		.filter((file) => file.fileName.includes(`/${localeDirectory(locale)}/`))
		.map((file) => (file.type === "chunk" ? file.code : String(file.source)))
		.join("");
}

/** The three messages each page shows, one of each kind, with the inputs an app passes them. */
const shownCalls = (app) =>
	["text", "inputs", "plural"].map((kind) => sampleCalls(app, 1, kind)[0]);

/** A page's entry whose `shown` calls each message, imported by name from `from`. */
const namedEntry = (calls, from) =>
	`import { ${calls.map((call, index) => `${JSON.stringify(call.key)} as m${index}`).join(", ")} } from ${JSON.stringify(from)};
export const shown = () => [${calls.map((call, index) => `m${index}(${takesInputs(call) ? JSON.stringify(call.inputs) : ""})`).join(", ")}];
`;

/** A page's entry whose `shown` asks a library's `t` for each message, from `from`. */
const translatedEntry = (calls, from, values) =>
	`import { t } from ${JSON.stringify(from)};
export const shown = () => [${calls.map((call) => `t(${JSON.stringify(call.key)}, ${JSON.stringify(values(call))})`).join(", ")}];
`;

/** Each library's page, and the page with no library, which shows the same three texts as written. */
async function pages(app, locale, calls) {
	const paraglide = await paraglideForVite(app);
	const { outdir } = await graiOutput(app);
	const { directory } = writeLibraryModules(app, locale, {
		keys: calls.map((call) => call.key),
		set: "shown",
	});
	return {
		grai: {
			library: "grai",
			localeChunks: true,
			entry: namedEntry(calls, join(outdir, "keys.js")),
		},
		Paraglide: {
			library: "paraglide",
			entry: namedEntry(calls, join(paraglide, "messages.js")),
		},
		i18next: {
			library: "i18next",
			entry: translatedEntry(
				calls,
				join(directory, `${locale}.i18next.js`),
				(call) => i18nextValues(app, call.key, call.inputs),
			),
		},
		"use-intl": {
			library: "use-intl",
			entry: translatedEntry(
				calls,
				join(directory, `${locale}.use-intl.js`),
				(call) => call.inputs,
			),
		},
	};
}

/** The bench's script: the texts the page's entry shows. */
const harness = (entry) =>
	`import { shown } from ${JSON.stringify(entry)}; window.bench = { shown: shown() };`;

/**
 * Builds a page as its library's client build does, loads it in Chromium in `locale`, and returns
 * what it shows and its JS: each script it loaded and each its index.html holds inline.
 */
async function loadPage(browser, app, locale, name, page) {
	const root = join(cacheDir, "library-bytes", app.id, name);
	rmSync(root, { recursive: true, force: true });
	mkdirSync(root, { recursive: true });
	writeFileSync(join(root, PAGE_ENTRY), page.entry);
	writeFileSync(
		join(root, "index.html"),
		`<!doctype html><html lang="${app.baseLocale}"><head><meta charset="utf-8"></head><body><script type="module" src="./${PAGE_ENTRY}"></script></body></html>\n`,
	);
	const directory = join(root, "dist");
	const built = await clientBuild(
		root,
		directory,
		await pluginsOf(page.library, app, {
			localeChunks: page.localeChunks === true,
		}),
	);
	const html = built.html
		.replace(`lang="${app.baseLocale}"`, `lang="${locale}"`)
		.replace(
			"</body>",
			() => `<script type="module">${harness(built.entry)}</script></body>`,
		);
	const { bench, scripts } = await benchPage(browser, app, locale, {
		html,
		directory,
		inline: built.inline,
	});
	return { shown: bench.shown, resources: scripts };
}

const sum = (resources) => ({
	brotli: resources.reduce((total, { brotli }) => total + brotli, 0),
	raw: resources.reduce((total, { raw }) => total + raw, 0),
});

/**
 * Each library's runtime in a page: its page's JS less the JS of the page that shows the same
 * texts with no library, and both pages' resources.
 */
async function runtimes(app, locale) {
	const calls = shownCalls(app);
	const browser = await chromium.launch();
	try {
		const loaded = {};
		for (const [name, page] of Object.entries(await pages(app, locale, calls)))
			loaded[name] = await loadPage(browser, app, locale, name, page);
		const { shown } = loaded.Paraglide;
		for (const [name, page] of Object.entries(loaded))
			if (JSON.stringify(page.shown) !== JSON.stringify(shown))
				throw new Error(
					`${name} shows ${JSON.stringify(page.shown)}, Paraglide ${JSON.stringify(shown)}`,
				);
		const plain = await loadPage(browser, app, locale, "no library", {
			library: "none",
			entry: `export const shown = () => ${JSON.stringify(shown)};\n`,
		});
		const floor = sum(plain.resources);
		return Object.fromEntries(
			Object.entries(loaded).map(([name, { resources }]) => {
				const page = sum(resources);
				return [
					name,
					{
						runtime: {
							brotli: page.brotli - floor.brotli,
							raw: page.raw - floor.raw,
						},
						page: { ...page, resources },
						withoutLibrary: { ...floor, resources: plain.resources },
					},
				];
			}),
		);
	} finally {
		await browser.close();
	}
}

const size = (bytes) =>
	bytes === undefined
		? "—"
		: `${(bytes.brotli / 1024).toFixed(1)} (${(bytes.raw / 1024).toFixed(0)})`;
const bytesOf = (code) =>
	code === undefined
		? undefined
		: { brotli: brotli(code), raw: Buffer.byteLength(code) };

for (const app of selectedApps()) {
	const locale = otherLocale(app);
	const { i18next, icu } = libraryCatalogs(app, locale);
	const { parse } = await import("@formatjs/icu-messageformat-parser");
	const ast = JSON.stringify(
		Object.fromEntries(
			Object.entries(icu).map(([key, message]) => [
				key,
				parse(message, { ignoreTag: true }),
			]),
		),
	);
	const paraglide = await paraglideForVite(app);
	const { compile } = await import(graiEntry("."));
	const config = writeGraiProject(app, "library-bytes");
	await compile(config);
	const graiOut = join(config, "..", "out", "runtime.js");
	const json = (file) => /\.json$/.test(file);
	const inPage = await runtimes(app, locale);
	const rows = [
		{
			library: "grai, as its build writes the locale's copies",
			...inPage.grai,
			messages: bytesOf(await graiBuiltMessages(config, locale)),
		},
		{
			library:
				"grai's first prototype: one per-locale module (not what it ships)",
			messages: bytesOf(
				await bundle(
					`export * from ${JSON.stringify(join(writePrototype(app), `${locale}.js`))};`,
				),
			),
		},
		{
			library: "Paraglide, every locale",
			...inPage.Paraglide,
			messages: bytesOf(
				await bundle(
					`export * from ${JSON.stringify(join(paraglide, "messages/_index.js"))};`,
					(id) => /\/(runtime|registry)\.js$/.test(id),
				),
			),
		},
		{
			library: "i18next",
			...inPage.i18next,
			messages: bytesOf(JSON.stringify(i18next)),
		},
		{
			library: "use-intl",
			...inPage["use-intl"],
			messages: bytesOf(JSON.stringify(icu)),
		},
		{
			library: "use-intl, messages precompiled to an AST",
			messages: bytesOf(ast),
		},
		{
			library: "grai, runtime.js with every export, alone",
			runtime: bytesOf(
				await bundle(`export * from ${JSON.stringify(graiOut)};`),
			),
		},
		{
			library: "Paraglide, runtime.js with every export, alone",
			runtime: bytesOf(
				await bundle(
					`export * from ${JSON.stringify(join(paraglide, "runtime.js"))};`,
				),
			),
		},
		{
			library: "i18next, init and t, alone",
			runtime: bytesOf(
				await bundle(
					`import i18next from "i18next"; import translation from "./catalog.json"; i18next.init({ lng: "${locale}", resources: { "${locale}": { translation } } }); export const t = i18next.t;`,
					json,
				),
			),
		},
		{
			library: "use-intl, createTranslator, alone",
			runtime: bytesOf(
				await bundle(
					`import { createTranslator } from "use-intl/core"; import messages from "./catalog.json"; export const t = createTranslator({ locale: "${locale}", messages });`,
					json,
				),
			),
		},
	];
	console.log(
		`\n### ${app.name}, ${locale}: what the browser downloads, KB brotli (raw)\n`,
	);
	console.log(
		"| library | runtime | its page | messages, the whole catalog in one locale |\n|---|---|---|---|",
	);
	for (const row of rows)
		console.log(
			`| ${row.library} | ${size(row.runtime)} | ${size(row.page)} | ${size(row.messages)} |`,
		);
	recordResults(`library-bytes-${app.id}`, rows, {
		app: app.name,
		locale,
		shown: shownCalls(app).map(({ key, kind }) => ({ key, kind })),
	});
}
