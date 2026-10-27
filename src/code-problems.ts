/**
 * What check reports of a project's code, from its reads (`code/reads.ts`): each place it names a
 * key no catalog has, each file that does not parse, and which keys shipped code reads or may reach,
 * so that any other is unused; and which keys only tests read, which ship nothing.
 */

import { sep } from "node:path";
import type { Reach, Read, Reading } from "./code/reads.ts";
import type { Config } from "./config.ts";
import { GraiError } from "./error.ts";
import { globMatcher } from "./globs.ts";
import { positionOf, type TestNames } from "./sources.ts";

/** What check takes from a project's code. */
export type CodeProblems = {
	errors: GraiError[];
	/** The reads of shipped code, and its reads that may reach more keys than one. */
	shipped: { reads: Read[]; reaches: Reach[] };
	/** Whether shipped code reads a key, or may reach it. */
	reached: (key: string) => boolean;
	/** The keys each test reads, as the report of a key only tests read names them. */
	tests: TestNames[];
};

export function codeProblems(
	reading: Reading,
	keys: ReadonlySet<string>,
	config: Config,
): CodeProblems {
	const isTest = globMatcher(config.tests);
	const testing = ({ source }: { source: { file: string } }) =>
		isTest(source.file.replaceAll(sep, "/"));
	const errors = [
		...readErrors(reading),
		...keysMissing(reading, keys, config),
	];
	const shipped = {
		reads: reading.reads.filter((read) => !testing(read)),
		reaches: reading.reaches.filter((reach) => !testing(reach)),
	};
	const named = new Set(shipped.reads.map(({ key }) => key));
	const reached = (key: string) =>
		named.has(key) || shipped.reaches.some((reach) => mayReach(reach, key));
	const tests = new Map<string, Set<string>>();
	for (const read of reading.reads) {
		if (!testing(read)) continue;
		const names = tests.get(read.source.file) ?? new Set<string>();
		names.add(read.key);
		tests.set(read.source.file, names);
	}
	return {
		errors,
		shipped,
		reached,
		tests: [...tests].map(([file, names]) => ({ file, names })),
	};
}

/** Each read of a key no catalog has, at its place, as a check and a build report it. */
export function keysMissing(
	reading: Reading,
	keys: { has: (key: string) => boolean },
	config: Config,
): GraiError[] {
	const texts = config.locales.map((locale) => `--${locale} "…"`).join(" ");
	// A read off a key's own module is reported where its path is.
	return reading.reads
		.filter(({ key, via }) => !keys.has(key) && via !== "module")
		.map(
			({ source, at, key, written }) =>
				new GraiError(
					"key-missing",
					{ file: placeOf(source, at.start), key },
					`${written} names a key no catalog has. Add it with grai add ${key} ${texts}, or fix the name.`,
				),
		);
}

/**
 * The errors that leave a reading's reads unknown: an import of the output that does not resolve,
 * and a file that does not parse. A command that changes the project acts on none while one stands.
 */
export function readErrors(reading: Reading): GraiError[] {
	return [
		...reading.unresolved.map(
			({ source, at, specifier }) =>
				new GraiError(
					"import-unresolved",
					{ file: placeOf(source, at.start) },
					`${specifier} is a path to grai's output, but nothing the project declares resolves it, so grai cannot tell what it reads. Declare it as the bundler resolves it: a Vite alias, a tsconfig path or a package.json "imports" entry.`,
				),
		),
		...reading.unreadable.map(
			({ source, at, message }) =>
				new GraiError(
					"source-invalid",
					{ file: placeOf(source, at.start) },
					`${message}, so grai cannot read its code. Fix it, as the bundler would fail it too.`,
				),
		),
	];
}

/**
 * The errors that leave reads unknown: a file that does not parse, and an import of the output
 * that does not resolve. A command that changes the project acts on none while one stands.
 */
export function unknownReads({ errors }: CodeProblems): GraiError[] {
	return errors.filter(
		({ code }) => code === "source-invalid" || code === "import-unresolved",
	);
}

/** Whether a read that may reach more keys than one reaches this one. */
export function mayReach({ prefix, choices }: Reach, key: string): boolean {
	return choices === undefined ? key.startsWith(prefix) : choices.includes(key);
}

function placeOf(source: Read["source"], at: number): string {
	const { line, column } = positionOf(source.text, at);
	return `${source.file}:${line}:${column}`;
}
