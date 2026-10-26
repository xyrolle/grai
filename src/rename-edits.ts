/**
 * Where a rename of a key changes the code: each place the code spells the key's name in a read of
 * it, and each binding named after the key, with every reference to it, written out in full where
 * it is a shorthand. It cannot rename the key where a read may reach it without naming it, or where
 * a binding's new name would change what code reads; each is an error at its place.
 */

import { bindingConflicts } from "./code/binding-rename.ts";
import type { Binding } from "./code/facts.ts";
import type { Edit, Read, Reading } from "./code/reads.ts";
import { mayReach } from "./code-problems.ts";
import { GraiError } from "./error.ts";
import { positionOf } from "./sources.ts";

/** A file a rename changes: its path as the project shows it, its text, and the edits. */
type Changed = { file: string; text: string; edits: Edit[] };

/** The edits a rename makes, by file path, or the errors that stop it. */
export async function codeEdits(
	reading: Reading,
	from: string,
	to: string,
): Promise<{ files: Map<string, Changed>; problems: GraiError[] }> {
	const files = new Map<string, Changed>();
	const problems = reading.reaches
		.filter((reach) => mayReach(reach, from))
		.map(({ source, at, written }) =>
			placed(
				source,
				at.start,
				"call-site-ambiguous",
				`${written} may read "${from}", so the rename cannot tell whether to change it. Read the key by its name there, or rename it by hand.`,
			),
		);
	const renamed = new Set<string>();
	for (const read of reading.reads) {
		if (read.key !== from) continue;
		const changed = changedFile(files, read);
		changed.edits.push(...read.edits);
		const { binding } = read;
		if (binding === undefined || binding.name !== from) continue;
		const id = `${read.path}\0${binding.at.start}`;
		if (renamed.has(id)) continue;
		renamed.add(id);
		changed.edits.push(...bindingEdits(binding));
		const conflicts = await bindingConflicts(
			read.path,
			read.source.text,
			binding,
			to,
		);
		for (const { at, why } of conflicts) {
			const detail =
				why === "declared"
					? `${to} is declared here, where ${from}, the key's binding, would take that name with the key. Rename this ${to} first, or import the key under another name.`
					: `${to} here would read the key's binding once it takes that name with the key. Rename this ${to} first, or import the key under another name.`;
			problems.push(placed(read.source, at.start, "binding-taken", detail));
		}
	}
	return { files, problems };
}

/** The text with each edit made: the span it covers replaced by its text around the new name. */
export function edited(
	text: string,
	edits: readonly Edit[],
	to: string,
): string {
	const unique = new Map(edits.map((edit) => [edit.at.start, edit]));
	let result = "";
	let last = 0;
	for (const { at, before, after } of [...unique.values()].toSorted(
		(a, b) => a.at.start - b.at.start,
	)) {
		result += text.slice(last, at.start) + before + to + after;
		last = at.end;
	}
	return result + text.slice(last);
}

/** A binding's declaration and references, each written out in full where it is a shorthand. */
function bindingEdits({ at, references }: Binding): Edit[] {
	return [
		{ at, before: "", after: "" },
		...references.map(({ at, shorthand }) =>
			shorthand === undefined
				? { at, before: "", after: "" }
				: {
						at: shorthand.replaces,
						before: shorthand.before,
						after: shorthand.after,
					},
		),
	];
}

function changedFile(
	files: Map<string, Changed>,
	{ path, source }: Read,
): Changed {
	const known = files.get(path);
	if (known !== undefined) return known;
	const changed: Changed = { file: source.file, text: source.text, edits: [] };
	files.set(path, changed);
	return changed;
}

function placed(
	source: { file: string; text: string },
	at: number,
	code: "call-site-ambiguous" | "binding-taken",
	detail: string,
): GraiError {
	const { line, column } = positionOf(source.text, at);
	return new GraiError(
		code,
		{ file: `${source.file}:${line}:${column}` },
		detail,
	);
}
