// The libraries import-fuzz.mjs compares grai with: how each makes a message, which names it reads
// there, so grai and the library get the same inputs, and how it renders a message.
import {
	isPluralElement,
	isSelectElement,
	isTagElement,
	parse,
	TYPE,
} from "@formatjs/icu-messageformat-parser";
import i18next from "i18next";
import { IntlMessageFormat } from "intl-messageformat";
import { i18nextMessage, icuMessage } from "./fuzz-messages.mjs";

/** intl-messageformat, as next-intl and react-intl use it, tags drawn as grai's markup is. */
export const icuLibrary = {
	format: "icu",
	message: icuMessage,
	texts: new Map(),
	inputsOf: (source, base) => withNames(base, icuNames(source)?.inputs ?? []),
	renderer: (_messages, locale) => (_key, source, inputs) => {
		const tags = [...(icuNames(source)?.tags ?? [])].map((name) => [
			name,
			(chunks) => `<${name}>${chunks.join("")}</${name}>`,
		]);
		const values = { ...inputs, ...Object.fromEntries(tags) };
		return new IntlMessageFormat(source, locale).format(values).toString();
	},
};

/** The inputs and tags an ICU message names, as intl-messageformat parses it; none if it rejects it. */
function icuNames(source) {
	let elements;
	try {
		elements = parse(source);
	} catch {
		return undefined;
	}
	const names = { inputs: new Set(), tags: new Set() };
	const visit = (nodes) => {
		for (const node of nodes) {
			if (isTagElement(node)) {
				names.tags.add(node.value);
				visit(node.children);
			} else if (node.type !== TYPE.literal && node.type !== TYPE.pound) {
				names.inputs.add(node.value);
			}
			if (isPluralElement(node) || isSelectElement(node)) {
				for (const option of Object.values(node.options)) visit(option.value);
			}
		}
	};
	visit(elements);
	return names;
}

/** i18next with escaping off, as grai leaves escaping to the framework that renders the text. */
export const i18nextLibrary = {
	format: "i18next",
	message: i18nextMessage,
	// The text the generated $t(title) nests.
	texts: new Map([["title", "Shop"]]),
	inputsOf: (source, base) => withNames(base, i18nextNames(source)),
	renderer: (messages, locale) => {
		const instance = i18next.createInstance();
		instance.init({
			lng: locale,
			resources: { [locale]: { translation: Object.fromEntries(messages) } },
			fallbackLng: false,
			interpolation: { escapeValue: false },
			initAsync: false,
		});
		return (key, _source, inputs) => instance.t(key, { replace: inputs });
	},
};

/**
 * The names i18next's placeholders read that a call can pass as grai's inputs: `{{-name}}`'s and
 * `{{name, format}}`'s, when the name is a JavaScript identifier.
 */
function i18nextNames(source) {
	const placeholders = [
		...source.matchAll(/\{\{-(.+?)\}\}/g),
		...source.matchAll(/\{\{(.+?)\}\}/g),
	];
	return placeholders
		.map(([, inside]) => inside.split(",")[0].trim())
		.filter((name) => /^[A-Za-z_$][\w$]*$/.test(name));
}

/** The base inputs, and each other name with its own name in capitals as its value. */
function withNames(base, names) {
	const others = [...names].filter((name) => !Object.hasOwn(base, name));
	return {
		...base,
		...Object.fromEntries(others.map((name) => [name, name.toUpperCase()])),
	};
}
