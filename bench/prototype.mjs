// Runtime shapes grai measured and did not adopt, or has not yet, compiled from the same catalogs
// as Paraglide's output so every bench runs both on equal inputs. Each locale is one module of
// plain functions, with no lookup and no dispatch, and a plural selects through the locale's CLDR
// rule compiled into a function: the shape text inlined at its call site takes. The server
// entries dispatch each key through a function of its own, reading the request's locale from
// AsyncLocalStorage or from a module variable. It covers what the two apps' catalogs use: text,
// {placeholders}, markup (dropped from the string, as Paraglide does), and selectors on inputs or
// on a plural of an input.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as makePlural from "make-plural/cardinals";
import { cacheDir } from "./apps.mjs";

const placeholder = /\{([^{}]*)\}/g;
// A plain object: a locale's rule is looked up by a name known only at run time.
const cardinals = { ...makePlural };

function hasInputs(pattern) {
	return [...pattern.matchAll(placeholder)].some(
		([, inside]) => !inside.startsWith("#") && !inside.startsWith("/"),
	);
}

function escapeTemplate(text) {
	return text.replace(/[`\\]|\$\{/g, (match) => `\\${match}`);
}

/** A pattern as a template literal: inputs interpolated, markup dropped. */
export function template(pattern) {
	const body = pattern.replace(placeholder, (_, inside) => {
		if (inside.startsWith("#") || inside.startsWith("/")) return "";
		return `\0${inside}\0`;
	});
	return `\`${body
		.split("\0")
		.map((part, index) =>
			index % 2 === 1 ? `\${i.${part}}` : escapeTemplate(part),
		)
		.join("")}\``;
}

function condition(selector, value, locals) {
	if (value === "*") return "true";
	if (locals.has(selector)) return `${selector} === ${JSON.stringify(value)}`;
	const asNumber = Number(value);
	if (value !== "" && Number.isFinite(asNumber))
		return `(i.${selector} === ${asNumber} || i.${selector} === ${JSON.stringify(value)})`;
	return `i.${selector} === ${JSON.stringify(value)}`;
}

function variants(key, message, rule) {
	const locals = new Map();
	for (const declaration of message.declarations) {
		const local = declaration.match(/^local (\w+) = (\w+): plural$/);
		if (local) locals.set(local[1], local[2]);
	}
	const lines = [...locals].map(
		([local, input]) => `const ${local} = ${rule}(i.${input});`,
	);
	for (const [match, pattern] of Object.entries(message.match)) {
		if (message.selectors.length === 0) {
			lines.push(`return ${template(pattern)};`);
			continue;
		}
		const values = match.split(",").map((part) => part.trim().split("=")[1]);
		const test = message.selectors
			.map((selector, index) => condition(selector, values[index], locals))
			.join(" && ");
		lines.push(`if (${test}) return ${template(pattern)};`);
	}
	lines.push(`return ${JSON.stringify(key)};`);
	return `(i) => {\n\t${lines.join("\n\t")}\n}`;
}

/** One message as a function's source; `rule` names the locale's plural rule in scope. */
export function messageFunction(key, value, rule = "pluralRule") {
	return typeof value === "string"
		? `(${hasInputs(value) ? "i" : ""}) => ${template(value)}`
		: variants(key, value[0], rule);
}

/**
 * One locale's catalog as a module of plain functions, or with `strings`, a message without
 * inputs as its string, for call sites the client build turns into references.
 */
export function localeModule(app, locale, strings = false) {
	const lines = [`const pluralRule = ${pluralRuleOf(locale)};`];
	for (const [key, value] of Object.entries(app.messages[locale])) {
		const text = strings && typeof value === "string" && !hasInputs(value);
		lines.push(
			`export const ${key} = ${text ? template(value) : messageFunction(key, value)};`,
		);
	}
	return `${lines.join("\n")}\n`;
}

/** A locale's compiled CLDR plural rule as source, for modules that hold several locales. */
export function pluralRuleOf(locale) {
	return cardinals[locale.split("-")[0]].toString();
}

const moduleName = (locale) => locale.replace(/\W/g, "_");

/**
 * Each key's locales as one table, in `locales` order: its strings where no locale's message has
 * inputs, else its per-locale functions, imported by name as a bundler links them.
 */
function keyTables(app) {
	const keys = Object.keys(app.messages[app.baseLocale]);
	const imports = app.locales.map(
		(locale) =>
			`import { ${keys.map((key) => `${key} as ${moduleName(locale)}_${key}`).join(", ")} } from "./${locale}.js";`,
	);
	const tables = keys.map((key) => {
		const literal = app.locales.every(
			(locale) =>
				typeof app.messages[locale][key] === "string" &&
				!hasInputs(app.messages[locale][key]),
		);
		const cells = app.locales.map((locale) =>
			literal
				? template(app.messages[locale][key])
				: `${moduleName(locale)}_${key}`,
		);
		return { key, literal, table: `[${cells.join(", ")}]` };
	});
	return { imports, tables };
}

/**
 * A server entry with a dispatcher per key: a call is one index and at most one call. `read` gives
 * the request's locale index: an AsyncLocalStorage read, or a module variable set per request
 * (fast, and wrong once requests interleave: interleave.mjs).
 */
function perKeyDispatchModule(app, read, bind) {
	const { imports, tables } = keyTables(app);
	const lines = [
		`import { AsyncLocalStorage } from "node:async_hooks";`,
		...imports,
		`const locales = ${JSON.stringify(app.locales)};`,
		`const storage = new AsyncLocalStorage();`,
		`let current = 0;`,
		`export const withLocale = (locale, render) => ${bind};`,
	];
	for (const { key, literal, table } of tables) {
		lines.push(`const ${key}$ = ${table};`);
		lines.push(
			literal
				? `export const ${key} = () => ${key}$[${read}];`
				: `export const ${key} = (i) => ${key}$[${read}](i);`,
		);
	}
	return `${lines.join("\n")}\n`;
}

const written = new Set();

/** Writes each locale's module and the server entries, once per run, and returns the directory. */
export function writePrototype(app) {
	const directory = join(cacheDir, "prototype", app.id);
	if (written.has(directory)) return directory;
	mkdirSync(directory, { recursive: true });
	for (const locale of app.locales) {
		writeFileSync(join(directory, `${locale}.js`), localeModule(app, locale));
		writeFileSync(
			join(directory, `${locale}.strings.js`),
			localeModule(app, locale, true),
		);
	}
	const read = "storage.getStore()";
	const bind = "storage.run(locales.indexOf(locale), render)";
	writeFileSync(
		join(directory, "server.js"),
		perKeyDispatchModule(app, read, bind),
	);
	writeFileSync(
		join(directory, "server-variable.js"),
		perKeyDispatchModule(
			app,
			"current",
			"((current = locales.indexOf(locale)), render())",
		),
	);
	written.add(directory);
	return directory;
}
