// An edit as an editor saves it into a catalog: the one message's text replaced where it stands, and
// every other byte of the file as it was, its layout and its last newline among them, so that a
// compile reads the save as the edit of one entry, as it does an editor's.
import { readFileSync } from "node:fs";

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The text of the catalog in `file` with `key`'s message, a text as the catalog writes it, made
 * `text`. Throws unless the file holds that entry once, as JSON writes it.
 */
export function editedCatalog(file, key, text) {
	const before = readFileSync(file, "utf8");
	const entry = new RegExp(
		`(${escaped(JSON.stringify(key))}\\s*:\\s*)${escaped(JSON.stringify(JSON.parse(before)[key]))}`,
		"g",
	);
	const found = before.match(entry)?.length ?? 0;
	if (found !== 1)
		throw new Error(
			`${file} holds ${key}'s message ${found} times as JSON writes it, not once.`,
		);
	return before.replace(entry, (_, head) => head + JSON.stringify(text));
}
