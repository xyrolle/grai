/**
 * Why a rename cannot change a key's uses safely, each an error naming the place: a source names
 * the key where it may mean something else, a read by a computed name may reach it, a file
 * declares the name its use goes through again, so the text cannot tell which is meant, or the
 * scan cannot tell whether the key's name is in code there.
 */

import type { FileUses } from "./call-sites.ts";
import { uncertainAt } from "./code-text.ts";
import { dynamicReadsIn } from "./dynamic-reads.ts";
import { GraiError } from "./error.ts";
import {
	messageBindings,
	namespaceNames,
	projectNamespaces,
} from "./message-imports.ts";
import { redeclarations } from "./redeclarations.ts";
import {
	escapedNames,
	occurrencesOf,
	positionOf,
	type SourceFile,
} from "./sources.ts";

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

/** An error for each place the files write the key's name with an escape, which the rename cannot find. */
export function escapeProblems(
	files: readonly SourceFile[],
	from: string,
): GraiError[] {
	return files
		.filter(({ text }) => text.includes("\\u"))
		.flatMap((source) =>
			escapedNames(source.code)
				.filter(({ name }) => name === from)
				.map(({ at }) =>
					placed(
						source,
						at,
						`it writes ${from} with an escape, which the rename cannot change safely. Write it plainly, or rename it by hand.`,
					),
				),
		);
}

/**
 * An error for each read by a computed name in the files that may reach the key: in their code,
 * and in their text where the scan cannot tell whether that is code.
 */
export function reachProblems(
	files: readonly SourceFile[],
	from: string,
): GraiError[] {
	const namespaces = projectNamespaces(files);
	const readsIn = (scanned: string) =>
		dynamicReadsIn(scanned, messageBindings(scanned, namespaces));
	return files.flatMap((source) => {
		const reads = readsIn(source.code);
		const uncertain =
			source.uncertain.length === 0
				? []
				: readsIn(source.text).filter(
						({ at }) =>
							uncertainAt(source.uncertain, at) !== undefined &&
							!reads.some((read) => read.at === at),
					);
		return [...reads, ...uncertain]
			.filter(({ prefix }) => from.startsWith(prefix))
			.map(({ at, written }) =>
				placed(
					source,
					at,
					`${written} may read "${from}", so the rename cannot change every read of it. Read it as m.${from}, or rename it by hand.`,
				),
			);
	});
}

/**
 * An error for each place a file writes the key's name where the scan cannot tell whether it is
 * code: in what may be JSX text, or after a `/` that may start a regular expression.
 */
export function uncertainProblems(
	files: readonly SourceFile[],
	from: string,
): GraiError[] {
	return files
		.filter(({ text }) => text.includes(from))
		.flatMap((source) =>
			occurrencesOf(source.text, from).flatMap((at) => {
				const place = uncertainAt(source.uncertain, at);
				if (place === undefined) return [];
				const why =
					place.why === "jsx"
						? `the scan reads the file's JSX text as JavaScript, so it cannot tell whether this ${from} is code, text or a comment`
						: `a / before it on the line may start a regular expression or divide, so the scan cannot tell whether this ${from} is code`;
				return [placed(source, at, `${why}. Rename the key by hand.`)];
			}),
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
	const namespaces = namespaceNames(sites.map(({ source }) => source.code));
	return sites.flatMap(({ source }) => {
		const bindings = messageBindings(source.code, namespaces);
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
			const [again] = redeclarations(source.code, name, bindings);
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
