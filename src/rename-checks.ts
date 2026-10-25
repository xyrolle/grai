/**
 * Why a rename cannot change a key's uses safely, each an error naming the place: a source names
 * the key where it may mean something else.
 */

import type { FileUses } from "./call-sites.ts";
import { GraiError } from "./error.ts";
import { occurrencesOf, positionOf } from "./sources.ts";

/** A file's places the rename cannot change safely: mentions, and a binding the new name would shadow. */
export function siteProblems(
	{ source, uses, bindsKey }: FileUses,
	from: string,
	to: string,
): GraiError[] {
	const problems = uses
		.filter(({ kind }) => kind === "mention")
		.map(({ at }) => {
			const { line, column } = positionOf(source.text, at);
			return new GraiError(
				"call-site-ambiguous",
				{ file: `${source.file}:${line}:${column}` },
				`it names ${from}, but not as m.${from}, m["${from}"] or a per-key import, so the rename cannot tell that it means the key. Write it as one of those, or rename it by hand.`,
			);
		});
	const clashes = bindsKey && occurrencesOf(source.text, to).length > 0;
	if (clashes) {
		problems.push(
			new GraiError(
				"key-exists",
				{ file: source.file, key: from },
				`the file imports ${from} by its own name, and already names ${to}, which the renamed import would clash with. Rename that first.`,
			),
		);
	}
	return problems;
}
