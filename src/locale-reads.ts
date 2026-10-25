/**
 * What one locale's function reads: its inputs, its plural locals and its number selectors. A
 * local is worked out once, in a const, before the variants are tried; a number selector has one
 * const for its number, and one for its category when a variant tests it.
 */

import type { LocaleMessage } from "./message.ts";
import { isExactKey } from "./number-select.ts";
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

/** The reads of a message's function, adding the functions of plurals.js they call to `plurals`. */
export function localeReads(
	message: LocaleMessage,
	plurals: Set<string>,
): LocaleReads {
	const { locale, selectors } = message;
	const reads = new Set<string>();
	/** The number selectors, by index, whose category a variant tests. */
	const categorized = new Set<number>();
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
				return `String(${value(selector.name)}) === ${literal}`;
			case "number":
				if (isExactKey(key)) return `${value(selector.name)} === ${key}`;
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
			const reader =
				selector.number === "number"
					? "Number"
					: called(numberReaders[selector.number]);
			const consts = [
				`const $${selector.name} = ${reader}(${value(selector.input)}); `,
			];
			if (selector.rules !== undefined && categorized.has(index)) {
				const plural = called(pluralName(locale, selector.rules));
				consts.push(`const $${index} = ${plural}($${selector.name}); `);
			}
			return consts;
		});
	const prologue = () => {
		const declarations = [...pluralConsts(), ...numberConsts()].join("");
		const takesInputs = [...reads].some((name) => message.inputs.has(name));
		return { parameter: takesInputs ? "i" : "", declarations };
	};
	return { value, condition, prologue };
}
