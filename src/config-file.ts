/** Editing the config file's text, for a command that changes keys the config lists. */

import { layoutOf, tabbedLayout, withMessages } from "./catalog-text.ts";
import type { IdenticalToBase } from "./identical-to-base.ts";

/**
 * The config's text with each key `identicalToBase` lists renamed to what `change` gives, or left
 * out where it gives undefined, or undefined when no listed key changes. A key renamed to one the
 * list has already is listed once, and a locale left with no keys is dropped. Only the field's
 * value is written again, in the config's layout, as a catalog's entry would be.
 */
export function withListedKeysChanged(
	text: string,
	identical: IdenticalToBase,
	change: (key: string) => string | undefined,
): string | undefined {
	const changes = [...identical.values()].some((keys) =>
		[...keys].some((key) => change(key) !== key),
	);
	if (!changes) return undefined;
	const lists = [...identical]
		.map(([locale, keys]): [string, string[]] => [
			locale,
			[...new Set([...keys].map(change))].filter((key) => key !== undefined),
		])
		.filter(([, keys]) => keys.length > 0);
	return withMessages(
		text,
		[["identicalToBase", Object.fromEntries(lists)]],
		layoutOf(text) ?? tabbedLayout,
	);
}
