// Imports the catalogs in import/ with `grai import`, compiles them, and renders every imported
// message with grai and with the library it came from, i18next or intl-messageformat, for each
// locale and a range of inputs. It lists every difference, apart from the ones the import reports:
// ICU's # formats a count for the locale (1,000 and 1,5), and i18next shows a key's name for a
// plural form a locale lacks. i18next runs with escapeValue off, as grai leaves escaping to the
// framework that renders the text.
//   node import-equivalence.mjs
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import i18next from "i18next";
import { IntlMessageFormat } from "intl-messageformat";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
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
		const report = execFileSync(
			process.execPath,
			[cli, "import", "--from", format, "source"],
			{ cwd: dir, encoding: "utf8" },
		);
		execFileSync(process.execPath, [cli, "compile"], { cwd: dir });
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
		for (const [key, sourceKey] of importedKeys(sources.en, format)) {
			if (!(key in m)) continue;
			for (const locale of locales) {
				const render =
					format === "i18next"
						? i18nextRenderer(sources[locale], locale)
						: icuRenderer(sources[locale], locale);
				for (const inputs of inputSets()) {
					const theirs = render(sourceKey, inputs);
					const ours = graiRender(m[key], inputs, locale);
					tally.compared++;
					if (theirs === ours) tally.equal++;
					else if (reportedDifference(theirs, ours, sourceKey, inputs, locale))
						tally.reported++;
					else
						tally.different.push(
							`${locale} ${sourceKey} ${JSON.stringify(inputs)}: ${JSON.stringify(theirs)} from ${format}, ${JSON.stringify(ours)} from grai`,
						);
				}
			}
		}
		const leftOut = report
			.split("\n")
			.filter((line) => line.startsWith("left out:")).length;
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
			yield { count, n: count, g, name: "Ana", value: count };
}

/** Each grai key the import wrote, with the key the source library calls it by. */
function importedKeys(catalog, format, path = []) {
	const keys = new Map();
	for (const [name, value] of Object.entries(catalog)) {
		const at = [...path, name];
		if (typeof value === "object") {
			for (const entry of importedKeys(value, format, at)) keys.set(...entry);
			continue;
		}
		const base =
			format === "i18next"
				? name.replace(/_(zero|one|two|few|many|other)$/, "")
				: name;
		const sourceKey = [...path, base].join(".");
		keys.set([...path, base].join("_").replace(/[^\w$]/g, "_"), sourceKey);
	}
	return keys;
}

function i18nextRenderer(catalog, locale) {
	const instance = i18next.createInstance();
	instance.init({
		lng: locale,
		resources: { [locale]: { translation: catalog } },
		fallbackLng: false,
		interpolation: { escapeValue: false },
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

/** A difference the import reports: # formatted for the locale, or i18next showing a key's name for a missing form. */
function reportedDifference(theirs, ours, sourceKey, inputs, locale) {
	if (theirs === sourceKey) return true;
	const formatted = new Intl.NumberFormat(locale).format(inputs.n);
	return (
		typeof ours === "string" &&
		ours.replaceAll(String(inputs.n), formatted) === theirs
	);
}
