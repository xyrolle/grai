import { freshName } from "./key-exports.ts";
import type { LocaleFunction } from "./locale-function.ts";

/**
 * A message with inputs as a server build holds it: a function of its own that switches on the
 * locale a call renders in, `localeIndex(options)`, with each locale's code in its case.
 *
 * A server calls many messages from one place, and through the runtime's shared `message` that
 * place calls every key's function of a locale: the engine stops optimising the call, and it costs
 * about twice what it does here, where each key's code holds its own locales. A server loads every
 * key once and calls them for as long as it runs, so this shape pays there. A page loads only its
 * own keys, and a text key or one with markup gains nothing from it (docs/design.md).
 *
 * `bound` holds every name the key's code refers to; the options take a name none of them has.
 */
export function serverMessage(
	functions: readonly LocaleFunction[],
	bound: ReadonlySet<string>,
): string {
	const options = freshName("o", bound);
	const cases = functions.map(
		(locale, index) =>
			`${caseOf(index, functions.length)}: ${returned(locale)}`,
	);
	return `function (i, ${options}) { switch (localeIndex(${options})) { ${cases.join(" ")} } }`;
}

/**
 * The case of the locale at `index`. `localeIndex` gives a configured locale's index or throws, so
 * the last locale's case is every index the others leave: as `default`, the switch returns on
 * every path.
 */
function caseOf(index: number, count: number): string {
	return index === count - 1 ? "default" : `case ${index}`;
}

/** A locale's code as its case runs it, in a block of its own where it declares locals. */
function returned({ declarations, body }: LocaleFunction): string {
	return declarations === ""
		? `return ${body};`
		: `{ ${declarations}return ${body}; }`;
}
