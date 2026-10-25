/**
 * The inputs a message shows: the data its text is made of, as a placeholder, an option a
 * formatter takes from an input, or a markup option's value, directly or through a formatted
 * local. An input it only chooses a variant by, such as the gender French agrees a word with, is
 * the language's grammar, which another language may not have.
 */

import type { Format } from "./format-options.ts";
import { markupVariables } from "./markup.ts";
import type { LocaleMessage } from "./message.ts";

export function shownInputs(message: LocaleMessage): Set<string> {
	const shown = new Set<string>();
	const showFormat = (format: Format | undefined) => {
		if (format?.input !== undefined) shown.add(format.input.name);
	};
	const show = (name: string) => {
		const local = message.formatted.get(name);
		if (local !== undefined) {
			shown.add(local.input);
			showFormat(local.format);
		} else if (!message.plurals.has(name)) shown.add(name);
	};
	for (const { pattern } of message.variants) {
		for (const part of pattern) {
			if (part.type === "variable") {
				show(part.name);
				showFormat(part.format);
			} else if (part.type !== "text") {
				for (const name of markupVariables(part)) show(name);
			}
		}
	}
	return shown;
}
