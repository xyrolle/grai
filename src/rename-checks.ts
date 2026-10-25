/**
 * Why a rename cannot change a key's uses safely, each an error naming the place: a source names
 * the key where it may mean something else, a read by a computed name may reach it, or a file
 * declares the name its use goes through again, so the text cannot tell which is meant.
 */

import type { FileUses } from "./call-sites.ts";
import { dynamicReadsIn } from "./dynamic-reads.ts";
import { GraiError } from "./error.ts";
import { messageBindings, namespaceNames } from "./message-imports.ts";
import { redeclarations } from "./redeclarations.ts";
import { occurrencesOf, positionOf, type SourceFile } from "./sources.ts";

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

/** An error for each read by a computed name in the files that may reach the key. */
export function reachProblems(
	files: readonly SourceFile[],
	from: string,
): GraiError[] {
	const namespaces = namespaceNames(files.map(({ text }) => text));
	return files.flatMap((source) =>
		dynamicReadsIn(source.text, messageBindings(source.text, namespaces))
			.filter(({ prefix }) => from.startsWith(prefix))
			.map(({ at, written }) =>
				placed(
					source,
					at,
					`${written} may read "${from}", so the rename cannot change every read of it. Read it as m.${from}, or rename it by hand.`,
				),
			),
	);
}

/**
 * An error for each file that reaches the key through a name it also declares again, such as a
 * parameter `m`: which of the file's uses read the key is then a matter of scope, which the text
 * does not show.
 */
export function ownershipProblems(
	sites: readonly FileUses[],
	from: string,
): GraiError[] {
	const namespaces = namespaceNames(sites.map(({ source }) => source.text));
	return sites.flatMap(({ source }) => {
		const bindings = messageBindings(source.text, namespaces);
		const keyNames = [...bindings.keys]
			.filter(([, key]) => key === from)
			.map(([local]) => [local, local] as const);
		const names = [
			...[...bindings.namespaces].map(
				(name) => [name, `${name}.${from}`] as const,
			),
			...keyNames,
		];
		return names.flatMap(([name, use]) => {
			const [again] = redeclarations(source.text, name, bindings);
			if (again === undefined) return [];
			return [
				placed(
					source,
					again,
					`the file declares ${name} again, so the rename cannot tell which of its ${use} read the key. Rename that ${name}, or rename the key by hand.`,
				),
			];
		});
	});
}

function placed(source: SourceFile, at: number, detail: string): GraiError {
	const { line, column } = positionOf(source.text, at);
	return new GraiError(
		"call-site-ambiguous",
		{ file: `${source.file}:${line}:${column}` },
		detail,
	);
}
