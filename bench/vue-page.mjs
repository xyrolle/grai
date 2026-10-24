// The page the Vue and Nuxt benches render, on grai and on vue-i18n alike: PAGE_KEYS messages chosen
// evenly across the catalog, among those both libraries can say alike, so it has the catalog's
// share of inputs and plurals, and the edited message's item, whose text changes it records.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const PAGE_KEYS = 500;

/** The plural categories of a locale, in the order vue-i18n's choices list them. */
const categoryOrder = ["zero", "one", "two", "few", "many", "other"];
export const categoriesOf = (locale) =>
	new Intl.PluralRules(locale)
		.resolvedOptions()
		.pluralCategories.toSorted(
			(a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b),
		);

/** A message as one plural on `count`, the shape both libraries express alike, or undefined. */
function countPlural(message) {
	if (!Array.isArray(message) || message.length !== 1) return undefined;
	const [{ declarations, selectors, match }] = message;
	const plural =
		declarations?.join() === "input count,local countPlural = count: plural";
	return plural && selectors?.join() === "countPlural" ? match : undefined;
}

/** Whether a pattern is text and inputs alone, with no markup, which vue-i18n has no way to say. */
const plainPattern = (pattern) =>
	typeof pattern === "string" && !/\{[#/]/.test(pattern);

/** Whether vue-i18n can say a message as grai does: text and inputs, or a plural on `count`. */
export function expressible(message) {
	const plural = countPlural(message);
	return plural === undefined
		? plainPattern(message)
		: Object.values(plural).every(plainPattern);
}

/** The keys the page renders, evenly spaced over the ones both libraries express, and its target. */
export function pageKeys(app) {
	const base = app.messages[app.baseLocale];
	const keys = Object.keys(base).filter((key) =>
		app.locales.every((locale) => expressible(app.messages[locale][key])),
	);
	const spaced = Array.from(
		{ length: PAGE_KEYS },
		(_, index) => keys[Math.floor((index * keys.length) / PAGE_KEYS)],
	);
	const chosen = [...new Set(spaced)];
	const target = chosen.find(
		(key) => typeof base[key] === "string" && !base[key].includes("{"),
	);
	return { keys: chosen, target };
}

/** The inputs a message reads, each with a value: a count of 3, and a name. */
export function inputsOf(message) {
	const source = JSON.stringify(message);
	const inputs = {};
	for (const [, name] of source.matchAll(/\{(\w+)\}/g)) inputs[name] = "Ana";
	if (countPlural(message) !== undefined) inputs.count = 3;
	return inputs;
}

/** Text as vue-i18n reads it: its special characters as literals, its `{name}` placeholders kept. */
const vueI18nText = (text) =>
	text.replace(/\{(\w+)\}|([@$|%{}])/g, (whole, name, special) =>
		name === undefined ? `{'${special}'}` : whole,
	);

/** A message in vue-i18n's syntax: text, or a plural's forms in its locale's order, by `|`. */
export function vueI18nMessage(message, locale) {
	const match = countPlural(message);
	if (match === undefined) return vueI18nText(message);
	return categoriesOf(locale)
		.map((category) =>
			vueI18nText(match[`countPlural=${category}`] ?? match["countPlural=*"]),
		)
		.join(" | ");
}

/** An expression's value in a template. */
export const shown = (expression) => `{{ ${expression} }}`;

/** Inputs as a template writes them: an object literal with single quotes. */
export const literal = (inputs) => JSON.stringify(inputs).replaceAll('"', "'");

/** Text as a Vue template writes it, with nothing in it read as markup or an interpolation. */
export const templateText = (text) =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/\{/g, "&#123;")
		.replace(/\}/g, "&#125;");

/**
 * The page's template: one list item per key, each what `render` gives, and the edited message's
 * item with the id `target`.
 */
export function template(app, { keys, target }, render) {
	const items = keys.map((key) => {
		const inputs = inputsOf(app.messages[app.baseLocale][key]);
		const id = key === target ? ' id="target"' : "";
		return `\t\t<li${id}>${render(key, inputs)}</li>`;
	});
	return `<template>\n\t<ul>\n${items.join("\n")}\n\t</ul>\n</template>\n`;
}

/**
 * Records when the target's text changes, for the edit bench, and what it is when the page has
 * mounted, as a page loaded again after an edit shows it.
 */
export const observer = `const changes = {};
Object.assign(window, { changes });
const record = () => {
	const text = document.getElementById("target")?.textContent;
	if (changes.target?.text !== text) changes.target = { text, at: performance.timeOrigin + performance.now() };
};
new MutationObserver(record).observe(document.body, { childList: true, characterData: true, subtree: true });
record();
`;

export function writeFiles(root, files) {
	rmSync(root, { recursive: true, force: true });
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), content);
	}
}
