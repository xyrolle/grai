/** A catalog file's text with messages set, in the layout it already has. */

import { existsSync, readFileSync } from "node:fs";
import { layoutOf, tabbedLayout, withMessages } from "./catalog-text.ts";
import { isRecord } from "./config.ts";

/**
 * The text of the catalog at `path` with the messages set: a key it has keeps its place, and a
 * new one goes at the end, so every entry the messages leave alone keeps its bytes. A catalog
 * without entries to show a layout takes that of `like`, another catalog of the project, and one
 * that does not exist yet also takes its `$schema` and the way its text ends.
 */
export function catalogWithMessages(
	path: string,
	messages: Iterable<readonly [string, unknown]>,
	like: string,
): string {
	if (existsSync(path)) {
		const text = readFileSync(path, "utf8");
		const layout =
			layoutOf(text) ?? layoutOf(readFileSync(like, "utf8")) ?? tabbedLayout;
		return withMessages(text, messages, layout);
	}
	const likeText = readFileSync(like, "utf8");
	const ending = likeText.slice(likeText.lastIndexOf("}") + 1);
	return withMessages(
		`{}${ending}`,
		[...schemaOf(likeText), ...messages],
		layoutOf(likeText) ?? tabbedLayout,
	);
}

/** The `$schema` entry of a catalog's text, when it has one. */
function schemaOf(text: string): [string, unknown][] {
	const parsed: unknown = JSON.parse(text);
	return isRecord(parsed) && "$schema" in parsed
		? [["$schema", parsed.$schema]]
		: [];
}
