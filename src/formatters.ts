/** The output's formatters: each format's name in a locale, and formats.js, which makes them. */

import { hash } from "node:crypto";
import type { Format } from "./format-options.ts";
import { formatterCode } from "./intl-formatters.ts";

/** A formatter of the output: a format in a locale, under the name formats.js exports it by. */
export type Formatter = { name: string; locale: string; format: Format };

/** A format's formatter in a locale. Its name is the same for the same locale and options. */
export function formatterOf(locale: string, format: Format): Formatter {
	const options = Object.keys(format.options).sort();
	const suffix =
		options.length === 0
			? ""
			: `_${hash("sha1", JSON.stringify(options.map((key) => [key, format.options[key]]))).slice(0, 8)}`;
	return {
		name: `${format.formatter}_${locale.replaceAll("-", "_")}${suffix}`,
		locale,
		format,
	};
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
			JSON.stringify(named.format) !== JSON.stringify(formatter.format)
		) {
			throw new Error(`grai gave two formats the name ${formatter.name}`);
		}
		byName.set(formatter.name, formatter);
	}
	const definitions = [...byName.values()]
		.sort((a, b) => (a.name < b.name ? -1 : 1))
		.map(({ name, locale, format }) => formatterCode(name, locale, format));
	return `// The Intl formatters the messages call, each made the first time it formats.\n\n${definitions.join("\n")}`;
}
