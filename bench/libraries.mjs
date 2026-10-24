// The same catalogs for the runtime libraries grai is compared with: i18next's JSON (v4 plurals
// as key suffixes, a select as a context) and ICU MessageFormat strings for intl-messageformat,
// as use-intl and next-intl read them. Markup is dropped, as the other benches' string output
// drops it. A message either format cannot hold is left out (`portable`), and `skipped` counts
// them. The modules written here give each library's `t(key, values)` for one locale.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./apps.mjs";

const placeholder = /\{([^{}]*)\}/g;

/** The plural's input and the selected input of a message, as an app passes them. */
function selection(value) {
	if (typeof value === "string") return {};
	const [message] = value;
	const local = message.declarations
		.map((declaration) => declaration.match(/^local (\w+) = (\w+): plural$/))
		.find(Boolean);
	const selector = message.selectors.find((name) => name !== local?.[1]);
	return { local: local?.[1], plural: local?.[2], selector };
}

/** A pattern with its text passed through `quote`, its placeholders through `write`, and markup dropped. */
function pattern(text, write, quote = (literal) => literal) {
	let result = "";
	let last = 0;
	for (const match of text.matchAll(placeholder)) {
		result += quote(text.slice(last, match.index));
		const inside = match[1];
		if (!inside.startsWith("#") && !inside.startsWith("/"))
			result += write(inside);
		last = match.index + match[0].length;
	}
	return result + quote(text.slice(last));
}

function i18nextEntries(key, value) {
	const write = (name) => `{{${name}}}`;
	if (typeof value === "string") return [[key, pattern(value, write)]];
	const [message] = value;
	if (message.selectors.length === 0)
		return [[key, pattern(Object.values(message.match)[0], write)]];
	return Object.entries(message.match).map(([match, text]) => {
		const option = match.split("=")[1];
		const suffix =
			option === "*" ? (selection(value).local ? "_other" : "") : `_${option}`;
		return [`${key}${suffix}`, pattern(text, write)];
	});
}

/** ICU's quoting: an apostrophe doubled is a literal one, and `#` in a plural is the number. */
const icuPattern = (text, inPlural) =>
	pattern(
		text,
		(name) => `{${name}}`,
		(literal) => {
			const quoted = literal.replaceAll("'", "''");
			return inPlural ? quoted.replaceAll("#", "'#'") : quoted;
		},
	);

function icuMessage(key, value) {
	if (typeof value === "string") return icuPattern(value, false);
	const [message] = value;
	if (message.selectors.length === 0)
		return icuPattern(Object.values(message.match)[0], false);
	const { local, plural, selector } = selection(value);
	const branches = Object.entries(message.match).map(([match, text]) => {
		const option = match.split("=")[1];
		return `${option === "*" ? "other" : option} {${icuPattern(text, Boolean(local))}}`;
	});
	if (
		!Object.keys(message.match).some((match) => match.endsWith("=*")) &&
		!local
	)
		branches.push(`other {${key}}`);
	return `{${local ? plural : selector}, ${local ? "plural" : "select"}, ${branches.join(" ")}}`;
}

/**
 * Whether both formats can hold a key: not with two selectors, and not with a plural of another
 * input beside a `count` placeholder, since i18next's plural always reads `count`.
 */
export function portable(app, key) {
	return app.locales.every((locale) => {
		const value = app.messages[locale][key];
		if (typeof value === "string") return true;
		const { plural } = selection(value);
		const [message] = value;
		const showsCount = Object.values(message.match).some((text) =>
			/\{count\}/.test(text),
		);
		return (
			message.selectors.length <= 1 &&
			(!plural || plural === "count" || !showsCount)
		);
	});
}

/** The library catalogs for one locale, and how many messages neither format can hold. */
export function libraryCatalogs(app, locale) {
	const i18next = {};
	const icu = {};
	let skipped = 0;
	for (const [key, value] of Object.entries(app.messages[locale])) {
		if (!portable(app, key)) {
			skipped++;
			continue;
		}
		const entries = i18nextEntries(key, value);
		const message = icuMessage(key, value);
		for (const [name, text] of entries) i18next[name] = text;
		icu[key] = message;
	}
	return { i18next, icu, skipped };
}

/** The values an app passes to i18next for a call: `count` for a plural, `context` for a select. */
export function i18nextValues(app, key, inputs) {
	const { plural, selector } = selection(app.messages[app.baseLocale][key]);
	return {
		...inputs,
		...(plural ? { count: inputs[plural] } : {}),
		...(selector ? { context: String(inputs[selector]) } : {}),
	};
}

/**
 * Writes, for one locale, each library's catalog as JSON and a module whose `t` is that library's
 * translate function for the locale: i18next's `getFixedT`, and use-intl's `createTranslator`,
 * which parses each message with intl-messageformat on its first call and caches it.
 */
export function writeLibraryModules(app, locale) {
	const directory = join(cacheDir, "libraries", app.id);
	mkdirSync(directory, { recursive: true });
	const { i18next, icu, skipped } = libraryCatalogs(app, locale);
	writeFileSync(
		join(directory, `${locale}.i18next.json`),
		JSON.stringify(i18next),
	);
	writeFileSync(join(directory, `${locale}.icu.json`), JSON.stringify(icu));
	writeFileSync(
		join(directory, `${locale}.i18next.js`),
		`import i18next from "i18next";
import translation from "./${locale}.i18next.json" with { type: "json" };
const instance = i18next.createInstance();
instance.init({ lng: ${JSON.stringify(locale)}, resources: { ${JSON.stringify(locale)}: { translation } }, initAsync: false, interpolation: { escapeValue: false } });
export const t = instance.getFixedT(${JSON.stringify(locale)});
`,
	);
	writeFileSync(
		join(directory, `${locale}.use-intl.js`),
		`import { createTranslator } from "use-intl/core";
import messages from "./${locale}.icu.json" with { type: "json" };
export const t = createTranslator({ locale: ${JSON.stringify(locale)}, messages, formats: undefined, onError(error) { throw error; } });
`,
	);
	return { directory, skipped };
}
