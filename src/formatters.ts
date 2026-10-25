/** The output's formatters: each format's name in a locale, and formats.js, which makes them. */

import { hash } from "node:crypto";
import type { IntlOptions } from "./format-functions.ts";
import type { Format } from "./format-options.ts";
import { digitsCode, formatterCode } from "./intl-formatters.ts";

/**
 * A formatter of the output: a format in a locale, under the name formats.js exports it by, and
 * whether it gives the text a reader sees or the digits a rounding selector reads.
 */
export type Formatter = {
	name: string;
	locale: string;
	format: Format;
	shows: "text" | "digits";
};

/**
 * What sets a format's formatter apart: its options, sorted, and the option an input gives, but
 * not the name of that input.
 */
function identity(format: Format): unknown[] {
	const options = Object.keys(format.options)
		.sort()
		.map((key) => [key, format.options[key]]);
	return format.input === undefined
		? options
		: [...options, [format.input.option]];
}

/**
 * A format's formatter in a locale. Its name is the same for the same locale, options and option
 * an input gives, whatever the input is called.
 */
export function formatterOf(locale: string, format: Format): Formatter {
	const parts = identity(format);
	const suffix =
		parts.length === 0
			? ""
			: `_${hash("sha1", JSON.stringify(parts)).slice(0, 8)}`;
	return {
		name: `${format.formatter}_${locale.replaceAll("-", "_")}${suffix}`,
		locale,
		format,
		shows: "text",
	};
}

/**
 * The formatter of a rounding number selector's digits, the same in every locale, as the digits
 * do not depend on it.
 */
export function digitsFormatter(options: IntlOptions): Formatter {
	const format: Format = { formatter: "number", options, input: undefined };
	const digest = hash("sha1", JSON.stringify(identity(format))).slice(0, 8);
	return { name: `digits_${digest}`, locale: "en", format, shows: "digits" };
}

/**
 * formats.js: each formatter the messages call, as a function of the value. The Intl formatter is
 * made the first time it formats, so a locale nobody reads makes none.
 */
export function formatModule(formatters: Iterable<Formatter>): string {
	const byName = new Map<string, Formatter>();
	for (const formatter of formatters) {
		const named = byName.get(formatter.name);
		if (
			named !== undefined &&
			(named.format.formatter !== formatter.format.formatter ||
				JSON.stringify(identity(named.format)) !==
					JSON.stringify(identity(formatter.format)))
		) {
			throw new Error(`grai gave two formats the name ${formatter.name}`);
		}
		byName.set(formatter.name, formatter);
	}
	const sorted = [...byName.values()].sort((a, b) =>
		a.name < b.name ? -1 : 1,
	);
	const imports = sorted.some(({ format }) => format.input !== undefined)
		? 'import { formatterFor } from "./runtime.js";\n\n'
		: "";
	const definitions = sorted.map(({ name, locale, format, shows }) =>
		shows === "digits"
			? digitsCode(name, format.options)
			: formatterCode(name, locale, format),
	);
	return `// The Intl formatters the messages call, each made the first time it formats.\n\n${imports}${definitions.join("\n")}`;
}
