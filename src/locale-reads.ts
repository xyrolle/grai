/**
 * What one locale's function reads: its inputs, its plural locals and its number selectors. A
 * local is worked out once, in a const, before the variants are tried; a number selector has one
 * const for its number, and one for its category when a variant tests it.
 */

import { digitsFormatter } from "./formatters.ts";
import type { Used } from "./locale-function.ts";
import type { LocaleMessage } from "./message.ts";
import { isExactKey, type NumberSelector } from "./number-select.ts";
import { numberReaders, pluralName } from "./plurals.ts";
import { catchAll } from "./selection.ts";

export type LocaleReads = {
	/** The code of an input, or of a local, by its name. */
	value: (name: string) => string;
	/** The test a variant's keys put on the selectors; empty when every key is `*`. */
	condition: (keys: readonly string[]) => string;
	/**
	 * Once the body is written: whether the function takes the inputs, and the consts the body
	 * reads, each followed by a space.
	 */
	prologue: () => { parameter: string; declarations: string };
};

/**
 * A global the code calls, such as `String`, by its name, added to the globals the key's code
 * calls: a module binds no key under such a name.
 */
export function globalCalled(name: string, globals: Set<string>): string {
	globals.add(name);
	return name;
}

/**
 * The reads of a message's function, adding the functions of plurals.js, the formatters and the
 * globals they call to `used`.
 */
export function localeReads(
	message: LocaleMessage,
	{ plurals, formats, globals }: Used,
): LocaleReads {
	const { locale, selectors } = message;
	const reads = new Set<string>();
	/** The number selectors, by index, whose category a variant tests. */
	const categorized = new Set<number>();
	/** The inputs of the `:string` selectors, by index, whose NFC text a variant tests. */
	const normalized = new Map<number, string>();
	const isLocal = (name: string) =>
		message.plurals.has(name) ||
		selectors.some(
			(selector) => selector.kind === "number" && selector.name === name,
		);
	const value = (name: string) => {
		reads.add(name);
		return isLocal(name) ? `$${name}` : `i[${JSON.stringify(name)}]`;
	};
	const test = (key: string, index: number): string => {
		const selector = selectors[index];
		const literal = JSON.stringify(key);
		switch (selector?.kind) {
			case undefined:
				return "";
			case "plural":
				return `${value(selector.name)} === ${literal}`;
			case "input":
				if (!selector.normalized) {
					return `${globalCalled("String", globals)}(${value(selector.input)}) === ${literal}`;
				}
				value(selector.input);
				normalized.set(index, selector.input);
				return `$${index} === ${JSON.stringify(key.normalize("NFC"))}`;
			case "number":
				if (isExactKey(key)) {
					const number = selector.digits === undefined ? key : literal;
					return `${value(selector.name)} === ${number}`;
				}
				value(selector.name);
				categorized.add(index);
				return `$${index} === ${literal}`;
		}
	};
	const condition = (keys: readonly string[]) =>
		keys
			.flatMap((key, index) => (key === catchAll ? [] : [test(key, index)]))
			.join(" && ");
	const called = (name: string) => {
		plurals.add(name);
		return name;
	};
	const pluralConsts = () =>
		[...message.plurals]
			.filter(([name]) => reads.has(name))
			.map(
				([name, { input, type }]) =>
					`const $${name} = ${called(pluralName(locale, type))}(${value(input)}); `,
			);
	const numberConsts = () =>
		selectors.flatMap((selector, index) => {
			if (selector.kind !== "number" || !reads.has(selector.name)) return [];
			const reader = readerOf(selector);
			const consts = [
				`const $${selector.name} = ${reader}(${value(selector.input)}); `,
			];
			if (selector.rules !== undefined && categorized.has(index)) {
				const plural = called(pluralName(locale, selector.rules));
				consts.push(`const $${index} = ${plural}($${selector.name}); `);
			}
			return consts;
		});
	/** What a number selector reads its input through: its digits' formatter, or a number reader. */
	const readerOf = (selector: NumberSelector) => {
		if (selector.digits !== undefined) {
			const formatter = digitsFormatter(selector.digits);
			formats.set(formatter.name, formatter);
			return formatter.name;
		}
		return selector.number === "number"
			? globalCalled("Number", globals)
			: called(numberReaders[selector.number]);
	};
	const textConsts = () =>
		[...normalized].map(
			([index, input]) =>
				`const $${index} = ${globalCalled("String", globals)}(${value(input)}).normalize("NFC"); `,
		);
	const prologue = () => {
		const declarations = [
			...pluralConsts(),
			...numberConsts(),
			...textConsts(),
		].join("");
		const takesInputs = [...reads].some((name) => message.inputs.has(name));
		return { parameter: takesInputs ? "i" : "", declarations };
	};
	return { value, condition, prologue };
}
