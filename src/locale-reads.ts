/**
 * What one locale's function reads: its inputs and its plural locals. A local is worked out once,
 * in a const, before the variants are tried.
 */

import type { LocaleMessage } from "./message.ts";
import { pluralName } from "./plurals.ts";
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

/** The reads of a message's function, adding the plural functions they call to `plurals`. */
export function localeReads(
	message: LocaleMessage,
	plurals: Set<string>,
): LocaleReads {
	const { locale, selectors } = message;
	const reads = new Set<string>();
	const value = (name: string) => {
		reads.add(name);
		return message.plurals.has(name) ? `$${name}` : `i.${name}`;
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
	const prologue = () => {
		const declarations = pluralConsts().join("");
		const takesInputs = [...reads].some((name) => message.inputs.has(name));
		return { parameter: takesInputs ? "i" : "", declarations };
	};
	return { value, condition, prologue };
}
