// Client bytes per page of a real app, built twice from one commit: on Paraglide and on grai. Each
// build's record (record-build.mjs, run in a copy of each, read by build-record.mjs) gives its
// pages, and the two builds are matched by route. grai's columns are its build's files as written:
// its message chunks, with every locale in each, and the reader's copies of them, which a page
// loads when an import map points it at them. Paraglide's build mixes its messages into other
// chunks, so its columns bundle the page's keys alone, minified by Rolldown into one file, which
// compresses better than the several chunks a build splits them into. The last two columns are a
// prototype, labelled so: its per-locale module, and its messages without inputs inlined.
//   node bytes.mjs <app> <Paraglide build's record> <grai build's record>
import { readFileSync } from "node:fs";
import { join, posix } from "node:path";
import { rolldown } from "rolldown";
import { selectedApps } from "./apps.mjs";
import { NOTHING, readBuild, sizes, sum } from "./build-record.mjs";
import { graiSource } from "./grai.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
import { template, writePrototype } from "./prototype.mjs";

const { localeDirectory, messageDirectory } = await import(
	join(graiSource, "message-directories.ts")
);

const [appName, paraglideRecord, graiRecord] = process.argv.slice(2);
const [app] = selectedApps([appName]);
const reader = app.locales.includes("ru") ? "ru" : app.baseLocale;

/**
 * A grai build's page: all it loads with the reader's copies, its message chunks, and what it
 * loads of them in its locale: a chunk's copy, or the chunk itself, which has none when it holds
 * something besides messages.
 */
function graiPage(build, files) {
	const others = [];
	const chunks = [];
	const copies = [];
	for (const file of files) {
		const size = build.sizeOf(file) ?? NOTHING;
		if (posix.basename(posix.dirname(file)) !== messageDirectory) {
			others.push(size);
			continue;
		}
		const copy = posix.join(
			posix.dirname(posix.dirname(file)),
			localeDirectory(reader),
			posix.basename(file),
		);
		chunks.push(size);
		copies.push(build.sizeOf(copy) ?? size);
	}
	return {
		js: sum([...others, ...copies]),
		chunks: sum(chunks),
		copies: sum(copies),
	};
}

// Paraglide's per-locale build compiles this expression and has Vite define it per locale, so the
// minifier folds every other locale away.
const STATIC_LOCALE =
	"/** @type {any} */ (globalThis).__PARAGLIDE_STATIC_LOCALE__";

/**
 * Minified bundle of `keys` exported from `from`. `locale` defines Paraglide's static locale and
 * bundles its runtime, so the fold can happen; otherwise the runtime, shared by every page, stays
 * out of the count.
 */
async function bundled(from, keys, locale, literals = []) {
	const entry = `export { ${keys.map((key) => JSON.stringify(key)).join(", ")} } from ${JSON.stringify(from)}; export const literals = [${literals.join(", ")}];`;
	const bundle = await rolldown({
		input: "entry",
		external: (id) =>
			/\/registry\.js$/.test(id) || (!locale && /\/runtime\.js$/.test(id)),
		plugins: [
			{
				name: "entry",
				resolveId: (id) => (id === "entry" ? id : null),
				load: (id) => (id === "entry" ? entry : null),
			},
		],
		transform: locale
			? {
					define: {
						"globalThis.__PARAGLIDE_STATIC_LOCALE__": JSON.stringify(locale),
					},
				}
			: undefined,
		logLevel: "silent",
	});
	const { output } = await bundle.generate({ format: "esm", minify: true });
	await bundle.close();
	return sizes(output[0].code);
}

const paraglide = readBuild(paraglideRecord, app.messages[app.baseLocale]);
const grai = readBuild(graiRecord, app.messages[app.baseLocale]);
const everyLocale = join(await paraglideOutput(app), "messages/_index.js");
const perLocaleBuild = join(
	await paraglideOutput(app, { experimentalStaticLocale: STATIC_LOCALE }),
	"messages/_index.js",
);
const prototype = join(writePrototype(app), `${reader}.js`);
// The prototype's experiment: a message without inputs inlined at its call site, its text once.
const withoutInputs = (key) =>
	typeof app.messages[reader][key] === "string" &&
	!/\{[^#/]/.test(app.messages[reader][key]);

const columns = {
	paraglideJs: "page JS, Paraglide build",
	graiJs: "page JS, grai build, the locale's copies",
	every: "Paraglide, every locale",
	perLocale: "Paraglide per-locale build",
	chunks: "grai's chunks as written, every locale",
	copies: "grai, the locale's copies",
	prototype: "prototype, one locale",
	inlined: "prototype, no-input messages inlined",
};
const { version: builtWith } = JSON.parse(
	readFileSync(
		join(paraglide.root, "node_modules/@inlang/paraglide-js/package.json"),
		"utf8",
	),
);
const kb = (bytes) => (bytes / 1024).toFixed(1);
const cells = (row) =>
	Object.keys(columns)
		.map((column) => `${kb(row[column].brotli)} (${kb(row[column].raw)})`)
		.join(" | ");
console.log(
	`\n### ${app.name}: bytes per page, KB brotli (raw), one locale = ${reader}; the app built with Paraglide ${builtWith}, its keys bundled with ${paraglideVersion}\n`,
);
console.log(
	`| page, by keys | keys loaded, Paraglide / grai | keys used | ${Object.values(columns).join(" | ")} |`,
);
console.log(`|---|---|---|${"---|".repeat(Object.keys(columns).length)}`);
const ranked = [...paraglide.pages]
	.filter(([, page]) => page.keys.length > 0)
	.sort(([, a], [, b]) => b.keys.length - a.keys.length);
const rows = [];
for (const [index, [route, page]] of ranked.entries()) {
	const graiBuilt = grai.pages.get(route);
	if (graiBuilt === undefined)
		throw new Error(`The grai build has no page ${route}`);
	const inlinedKeys = page.keys.filter(withoutInputs);
	const { js, chunks, copies } = graiPage(grai, graiBuilt.files);
	const row = {
		paraglideJs: sum(
			page.files.map((file) => paraglide.sizeOf(file) ?? NOTHING),
		),
		graiJs: js,
		every: await bundled(everyLocale, page.keys),
		perLocale: await bundled(perLocaleBuild, page.keys, reader),
		chunks,
		copies,
		prototype: await bundled(prototype, page.keys),
		inlined: await bundled(
			prototype,
			page.keys.filter((key) => !withoutInputs(key)),
			undefined,
			inlinedKeys.map((key) => template(app.messages[reader][key])),
		),
	};
	rows.push(row);
	if (index < 10 || index === ranked.length - 1)
		console.log(
			`| ${index + 1} | ${page.keys.length} / ${graiBuilt.keys.length} | ${page.used.size} | ${cells(row)} |`,
		);
}
const totals = Object.fromEntries(
	Object.keys(columns).map((column) => [
		column,
		sum(rows.map((row) => row[column])),
	]),
);
console.log(`| all ${ranked.length}, summed | | | ${cells(totals)} |`);
const less = (column, than) =>
	`${(100 * (1 - totals[column].brotli / totals[than].brotli)).toFixed(0)}%`;
console.log(
	`\nSummed brotli: grai's locale copies are ${less("copies", "chunks")} smaller than its chunks as written, and ${less("copies", "every")} smaller than Paraglide's keys in every locale, whose per-locale build is ${less("perLocale", "every")} smaller. A page's JS on grai, with the locale's copies, is ${less("graiJs", "paraglideJs")} smaller than on Paraglide.`,
);
