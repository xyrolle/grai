// What each library ships to the browser for one locale, KB brotli (raw): its runtime, bundled
// and minified by Rolldown, and its messages for the whole catalog. i18next and use-intl load a
// locale's whole catalog (or namespace) on every page; grai and Paraglide ship only the keys a
// page imports, which `bytes` measures per page. grai's runtime is the one its compiler writes;
// its messages are the locale's copies of the message chunks a Vite build with grai's plugin
// writes for a page that names every key. Beside them, the per-locale module the design started
// from, as prototype.mjs writes it.
//   node library-bytes.mjs [app...]
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import { rolldown } from "rolldown";
import { build } from "vite";
import { selectedApps } from "./apps.mjs";
import { graiEntry, graiModule, writeGraiProject } from "./grai.mjs";
import { libraryCatalogs } from "./libraries.mjs";
import { paraglideOutput } from "./paraglide.mjs";
import { writePrototype } from "./prototype.mjs";
import { otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";

const brotli = (code) =>
	brotliCompressSync(Buffer.from(code), {
		params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
	}).length;

/** A minified browser bundle of `source`; `external` modules stay out of it. */
async function bundle(source, external = () => false) {
	const build = await rolldown({
		input: "entry",
		platform: "browser",
		external,
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

const size = (code) =>
	`${(brotli(code) / 1024).toFixed(1)} (${(Buffer.byteLength(code) / 1024).toFixed(0)})`;

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
	const paraglide = await paraglideOutput(app);
	const { compile } = await import(graiEntry("."));
	const config = writeGraiProject(app, "library-bytes");
	await compile(config);
	const graiOut = join(config, "..", "out", "runtime.js");
	const json = (file) => /\.json$/.test(file);
	const rows = [
		[
			"grai, as its build writes the locale's copies",
			await bundle(`export * from ${JSON.stringify(graiOut)};`),
			await graiBuiltMessages(config, locale),
		],
		[
			"grai's first prototype: one per-locale module (not what it ships)",
			undefined,
			await bundle(
				`export * from ${JSON.stringify(join(writePrototype(app), `${locale}.js`))};`,
			),
		],
		[
			"Paraglide, every locale",
			await bundle(
				`export * from ${JSON.stringify(join(paraglide, "runtime.js"))};`,
			),
			await bundle(
				`export * from ${JSON.stringify(join(paraglide, "messages/_index.js"))};`,
				(id) => /\/(runtime|registry)\.js$/.test(id),
			),
		],
		[
			"i18next",
			await bundle(
				`import i18next from "i18next"; import translation from "./catalog.json"; i18next.init({ lng: "${locale}", resources: { "${locale}": { translation } } }); export const t = i18next.t;`,
				json,
			),
			JSON.stringify(i18next),
		],
		[
			"use-intl",
			await bundle(
				`import { createTranslator } from "use-intl/core"; import messages from "./catalog.json"; export const t = createTranslator({ locale: "${locale}", messages });`,
				json,
			),
			JSON.stringify(icu),
		],
		["use-intl, messages precompiled to an AST", undefined, ast],
	];
	console.log(
		`\n### ${app.name}, ${locale}: what the browser downloads, KB brotli (raw)\n`,
	);
	console.log(
		"| library | runtime | messages, the whole catalog in one locale |\n|---|---|---|",
	);
	for (const [name, runtime, messages] of rows)
		console.log(
			`| ${name} | ${runtime ? size(runtime) : "the same"} | ${size(messages)} |`,
		);
	const bytes = (code) =>
		code === undefined
			? undefined
			: { brotli: brotli(code), raw: Buffer.byteLength(code) };
	recordResults(
		`library-bytes-${app.id}`,
		rows.map(([name, runtime, messages]) => ({
			library: name,
			runtime: bytes(runtime),
			messages: bytes(messages),
		})),
		{ app: app.name, locale },
	);
}
