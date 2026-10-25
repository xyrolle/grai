/**
 * The file of each key's description for translators, which the config's `descriptions` names:
 * whether "Open" is a verb or a state, say. It sits beside the catalogs, not in them, so that they
 * stay the inlang format Paraglide reads. `grai export` writes each as a note of its key's units,
 * and `grai rename` and `grai check --fix` keep it in step with the catalogs.
 */

import { existsSync, readFileSync } from "node:fs";
import { relative } from "node:path";
import { messageEntries } from "./catalog-entries.ts";
import { keyOf } from "./catalog-keys.ts";
import { tabbedLayout } from "./catalog-layout.ts";
import { withKeyRenamed, withMessages, withoutKeys } from "./catalog-text.ts";
import { type Config, isRecord } from "./config.ts";
import { GraiError } from "./error.ts";

/** Each key's description, in the file's order. */
export type Descriptions = ReadonlyMap<string, string>;

const none: Descriptions = new Map();

/**
 * The project's descriptions: none when the config names no file, or the file is not there yet.
 * Throws a GraiError for a file that is not a JSON object of texts.
 */
export function readDescriptions(config: Config): Descriptions {
	const file = config.descriptions;
	if (file === undefined || !existsSync(file)) return none;
	const invalid = (detail: string) =>
		new GraiError(
			"descriptions-invalid",
			{ file: relative(config.root, file) },
			detail,
		);
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
		throw invalid(`it cannot be read as JSON: ${error.message}.`);
	}
	const entries = isRecord(value) ? Object.entries(value) : [];
	const texts = entries.filter(
		(entry): entry is [string, string] => typeof entry[1] === "string",
	);
	if (!isRecord(value) || texts.length < entries.length) {
		throw invalid(
			'it must hold a JSON object of each key\'s description, a text, such as { "open": "A verb: the button opens the menu" }.',
		);
	}
	return new Map(texts);
}

/** The text of a new descriptions file, an entry per line indented by a tab. */
export function descriptionsText(descriptions: Descriptions): string {
	return withMessages(
		"{}\n",
		[...descriptions].map(([key, text]) => [[key], text]),
		tabbedLayout,
	);
}

/** The descriptions file's text with a key renamed, as `grai rename` renames it; undefined when the file does not describe it. */
export function descriptionsRenamed(
	config: Config,
	from: string,
	to: string,
): { file: string; text: string } | undefined {
	return changedFile(config, (text) => {
		const entry = messageEntries(text).find(({ path }) => keyOf(path) === from);
		return entry === undefined ? text : withKeyRenamed(text, entry, to);
	});
}

/** The descriptions file's text without the keys `grai check --fix` removes; undefined when it describes none of them. */
export function descriptionsWithout(
	config: Config,
	keys: ReadonlySet<string>,
): { file: string; text: string } | undefined {
	return changedFile(config, (text) => withoutKeys(text, keys));
}

function changedFile(
	config: Config,
	change: (text: string) => string,
): { file: string; text: string } | undefined {
	const file = config.descriptions;
	if (file === undefined || !existsSync(file)) return undefined;
	const text = readFileSync(file, "utf8");
	const changed = change(text);
	return changed === text ? undefined : { file, text: changed };
}

/** What `grai check` reports of the descriptions: the file's problem, or each one whose key no catalog has. */
export function descriptionProblems(
	config: Config,
	keys: ReadonlySet<string>,
): GraiError[] {
	let descriptions: Descriptions;
	try {
		descriptions = readDescriptions(config);
	} catch (error) {
		if (!(error instanceof GraiError)) throw error;
		return [error];
	}
	const file = relative(config.root, config.descriptions ?? "");
	return [...descriptions.keys()]
		.filter((key) => !keys.has(key))
		.map(
			(key) =>
				new GraiError(
					"description-stale",
					{ file, key },
					"no catalog has the key it describes. Remove it, or fix its name.",
				),
		);
}
