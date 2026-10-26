/** A catalog file's text with messages set, in the layout it already has. */

import { existsSync, readFileSync } from "node:fs";
import { type KeyPath, schemaKey } from "./catalog-keys.ts";
import { layoutOf, tabbedLayout } from "./catalog-layout.ts";
import { withMessages } from "./catalog-text.ts";
import { isRecord } from "./config.ts";

/**
 * The text of the catalog at `path` with the messages set at their paths: a key it has keeps its
 * place, and a new one goes at the end of its object, so every entry the messages leave alone
 * keeps its bytes. A catalog
 * without entries to show a layout takes that of `like`, another catalog of the project, and one
 * that does not exist yet also takes its `$schema` and the way its text ends.
 */
export function catalogWithMessages(
	path: string,
	messages: Iterable<readonly [KeyPath, unknown]>,
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

/**
 * The texts of a locale's catalog files, at `paths`, with the messages set: each in the file at the
 * place its entry names, which `catalogWithMessages` gives `like`'s layout when it has none.
 */
export function catalogsWithMessages(
	paths: readonly string[],
	messages: Iterable<readonly [KeyPath, unknown, file: number]>,
	like: string,
): Map<string, string> {
	const byFile = new Map<number, [KeyPath, unknown][]>();
	for (const [path, value, file] of messages) {
		const entries = byFile.get(file);
		if (entries === undefined) byFile.set(file, [[path, value]]);
		else entries.push([path, value]);
	}
	const texts = new Map<string, string>();
	paths.forEach((path, file) => {
		const entries = byFile.get(file);
		if (entries !== undefined) {
			texts.set(path, catalogWithMessages(path, entries, like));
		}
	});
	return texts;
}

/** The `$schema` entry of a catalog's text, when it has one. */
function schemaOf(text: string): [KeyPath, unknown][] {
	const parsed: unknown = JSON.parse(text);
	return isRecord(parsed) && schemaKey in parsed
		? [[[schemaKey], parsed[schemaKey]]]
		: [];
}
