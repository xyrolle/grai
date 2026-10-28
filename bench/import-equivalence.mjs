// Imports the catalogs in import/ with `grai import`, compiles them, and renders every imported
// message with grai and with the library it came from, i18next or intl-messageformat, for each
// locale and a range of inputs. It lists every difference, apart from those the import reports:
// i18next shows a key's name for a plural form a locale lacks, and escapes values for HTML. i18next
// runs with escapeValue off, as grai leaves escaping to the framework that renders the text, and
// then again with its default, over values with HTML in them, where only the messages the import
// says it escapes may differ.
//   node import-equivalence.mjs
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import i18next from "i18next";
import { IntlMessageFormat } from "intl-messageformat";
import { graiCli, graiModule } from "./grai.mjs";

const { importCatalogs } = await import(graiModule("import.ts"));

const locales = ["en", "ru", "ar"];
const counts = [0, 1, 2, 3, 5, 11, 12, 21, 22, 25, 100, 101, 1000, 1.5];
const genders = ["male", "female", "other"];
const tag = (name) => (chunks) => `<${name}>${chunks.join("")}</${name}>`;

let failed = false;
for (const format of ["i18next", "icu"]) {
	const dir = mkdtempSync(join(tmpdir(), "grai-import-"));
	try {
		cpSync(
			fileURLToPath(new URL(`import/${format}`, import.meta.url)),
			join(dir, "source"),
			{ recursive: true },
		);
		writeFileSync(
			join(dir, "grai.config.json"),
			JSON.stringify({
				locales,
				baseLocale: "en",
				catalogs: "messages/{locale}.json",
				outdir: "out",
			}),
		);
		const report = importCatalogs(join(dir, "grai.config.json"), format, [
			join(dir, "source"),
		]);
		const escaped = new Set(
			report.changed
				.filter(({ detail }) => detail.startsWith("i18next escapes"))
				.map(({ key }) => key),
		);
		execFileSync(process.execPath, [graiCli, "compile"], { cwd: dir });
		const { m } = await import(
			pathToFileURL(join(dir, "out", "messages.js")).href
		);
		const sources = Object.fromEntries(
			await Promise.all(
				locales.map(async (locale) => [
					locale,
					(
						await import(
							pathToFileURL(join(dir, "source", `${locale}.json`)).href,
							{ with: { type: "json" } }
						)
					).default,
				]),
			),
		);
		const tally = { compared: 0, equal: 0, reported: 0, different: [] };
		for (const [key, { sourceKey, options }] of importedKeys(
			sources.en,
			format,
		)) {
			if (!(key in m)) continue;
			for (const locale of locales) {
				const modes =
					format === "i18next"
						? [
								{
									render: i18nextRenderer(sources[locale], locale, false),
									inputs: inputSets(),
									escapes: false,
								},
								{
									render: i18nextRenderer(sources[locale], locale, true),
									inputs: htmlInputSets(),
									escapes: true,
								},
							]
						: [
								{
									render: icuRenderer(sources[locale], locale),
									inputs: inputSets(),
									escapes: false,
								},
							];
				for (const { render, inputs, escapes } of modes) {
					for (const input of inputs) {
						const theirs = render(sourceKey, { ...input, ...options });
						const ours = graiRender(m[key], input, locale);
						tally.compared++;
						if (theirs === ours) tally.equal++;
						else if (
							reportedDifference(theirs, sourceKey) ||
							(escapes && escaped.has(sourceKey))
						)
							tally.reported++;
						else
							tally.different.push(
								`${locale} ${sourceKey} ${JSON.stringify(input)}: ${JSON.stringify(theirs)} from ${format}, ${JSON.stringify(ours)} from grai`,
							);
					}
				}
			}
		}
		const leftOut = report.leftOut.length;
		console.log(
			`${format}: ${tally.compared} renders of the imported keys compared, ${tally.equal} equal, ${tally.reported} differ as the import reports, ${tally.different.length} differ otherwise; ${leftOut} keys left out, as reported`,
		);
		for (const line of tally.different.slice(0, 20)) console.log(`  ${line}`);
		if (tally.different.length > 0) failed = true;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
process.exitCode = failed ? 1 : 0;

function* inputSets() {
	for (const count of counts)
		for (const g of genders)
			yield {
				count,
				n: count,
				g,
				name: "Ana",
				names: ["Ana", "Ion", "Maria"].slice(0, count % 4),
				value: count,
				d: dateOf(count),
			};
}

/**
 * Each grai key the import wrote, with the key the source library calls it by and the options of
 * that call: an i18next key's ordinal forms become the grai key ending in _ordinal, which i18next
 * calls by the plural's key with { ordinal: true }.
 */
function importedKeys(catalog, format, path = []) {
	const keys = new Map();
	for (const [name, value] of Object.entries(catalog)) {
		const at = [...path, name];
		if (typeof value === "object") {
			for (const entry of importedKeys(value, format, at)) keys.set(...entry);
			continue;
		}
		const ordinal =
			format === "i18next" &&
			/_ordinal_(zero|one|two|few|many|other)$/.test(name);
		const base =
			format === "i18next"
				? name.replace(/(_ordinal)?_(zero|one|two|few|many|other)$/, "")
				: name;
		const key = [...path, ordinal ? `${base}_ordinal` : base]
			.join("_")
			.replace(/[^\w$]/g, "_");
		keys.set(key, {
			sourceKey: [...path, base].join("."),
			options: ordinal ? { ordinal: true } : {},
		});
	}
	return keys;
}

/** Values with HTML in them, for i18next's escaping to show. */
function* htmlInputSets() {
	for (const count of [3, 21])
		yield {
			count,
			n: count,
			g: "female",
			name: "<b>A&B</b>",
			names: ["<i>Ion</i>", "Ana & Maria"],
			value: count,
			d: dateOf(count),
		};
}

function i18nextRenderer(catalog, locale, escapeValue) {
	const instance = i18next.createInstance();
	instance.init({
		lng: locale,
		resources: { [locale]: { translation: catalog } },
		fallbackLng: false,
		interpolation: { escapeValue },
		initAsync: false,
	});
	return (key, inputs) => instance.t(key, inputs);
}

function icuRenderer(catalog, locale) {
	const sources = new Map(flattened(catalog));
	return (key, inputs) =>
		new IntlMessageFormat(sources.get(key), locale)
			.format({ ...inputs, b: tag("b"), i: tag("i") })
			.toString();
}

function* flattened(catalog, path = []) {
	for (const [name, value] of Object.entries(catalog)) {
		if (typeof value === "object") yield* flattened(value, [...path, name]);
		else yield [[...path, name].join("."), value];
	}
}

function graiRender(message, inputs, locale) {
	if (message === undefined) return undefined;
	if (typeof message.parts !== "function") return message(inputs, { locale });
	return message
		.parts(inputs, { locale })
		.map((part) =>
			part.type === "text"
				? part.value
				: part.type === "markup-start"
					? `<${part.name}>`
					: `</${part.name}>`,
		)
		.join("");
}

/** A difference the import reports: i18next showing a key's name for a missing form. */
function reportedDifference(theirs, sourceKey) {
	return theirs === sourceKey;
}

/** A date a count apart, in days and hours, from one moment. */
function dateOf(count) {
	return new Date(Date.UTC(2026, 9, 24, 15, 5, 30) + count * 90_000_000);
}
