import { messageEntries } from "./catalog-entries.ts";
import { keyOf } from "./catalog-keys.ts";
import { readProjectCode } from "./code/project.ts";
import { readingOf } from "./code/reads.ts";
import { mayReach, readErrors } from "./code-problems.ts";
import { parseCatalogs, readProject } from "./compile.ts";
import { GraiError } from "./error.ts";
import { compileOutputIfMissing } from "./output-present.ts";
import { lineAt, positionOf } from "./sources.ts";

/** A place a key is: the file, the line and column of the key there, and the line's text. */
export type FoundLine = {
	file: string;
	line: number;
	column: number;
	text: string;
};

export type FindResult = {
	/** The key's entry in each catalog that has it. */
	catalogs: FoundLine[];
	/** Each place code names the key in a read of it, and each use of a name such a read binds. */
	callSites: FoundLine[];
	/** Each read that may reach the key among others: by a computed name, whole, or by a pattern. */
	reaches: FoundLine[];
	errors: GraiError[];
};

/**
 * Every place a key is: its entry in each catalog, and each read of it in the code under the roots
 * (the project's root by default), read as `check` reads it. A key no catalog has is an error, and
 * so is a file whose reads cannot be known, as it does not parse or imports the output by a path
 * nothing resolves.
 */
export async function find(
	configFile: string,
	key: string,
	roots?: readonly string[],
): Promise<FindResult> {
	const found: FindResult = {
		catalogs: [],
		callSites: [],
		reaches: [],
		errors: [],
	};
	const read = await readProject(configFile);
	if ("errors" in read) return { ...found, errors: read.errors };
	const { errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return { ...found, errors };
	for (const { file, bytes } of read.sources) {
		const text = bytes.toString("utf8");
		const entry = messageEntries(text).find(({ path }) => keyOf(path) === key);
		if (entry !== undefined) {
			found.catalogs.push(foundLine(file, text, entry.keyStart));
		}
	}
	const { config } = read;
	const compiled = await compileOutputIfMissing(configFile, config);
	if (compiled.length > 0) return { ...found, errors: [...compiled] };
	const code = await readProjectCode(config, roots ?? [config.root], key);
	if (code instanceof GraiError) return { ...found, errors: [code] };
	const reading = await readingOf(code, key);
	found.errors.push(...readErrors(reading));
	const sites = new Map<string, FoundLine & { at: number }>();
	const site = ({ file, text }: { file: string; text: string }, at: number) =>
		sites.set(`${file}\0${at}`, { ...foundLine(file, text, at), at });
	for (const { key: each, source, at, edits, binding } of reading.reads) {
		if (each !== key) continue;
		for (const place of [at, ...edits.map((edit) => edit.at)]) {
			site(source, place.start);
		}
		for (const reference of binding?.references ?? []) {
			site(source, reference.at.start);
		}
	}
	found.callSites = [...sites.values()]
		.toSorted((a, b) =>
			a.file === b.file ? a.at - b.at : a.file < b.file ? -1 : 1,
		)
		.map(({ at, ...line }) => line);
	found.reaches = reading.reaches
		.filter((reach) => mayReach(reach, key))
		.map(({ source, at }) => foundLine(source.file, source.text, at.start));
	if (found.catalogs.length === 0) {
		const base = read.sources.find(
			({ locale }) => locale === config.baseLocale,
		);
		found.errors.push(
			new GraiError(
				"key-missing",
				{ file: base?.file ?? "", key },
				"no catalog has the key.",
			),
		);
	}
	return found;
}

/** What find prints: each place as `file:line:column: text`, a reach marked, then a count. */
export function foundLines(key: string, found: FindResult): string[] {
	const place = ({ file, line, column, text }: FoundLine) =>
		`${file}:${line}:${column}: ${text.trim()}`;
	const reaches = found.reaches.length;
	return [
		...found.catalogs.map(place),
		...found.callSites.map(place),
		...found.reaches.map((reach) => `${place(reach)} (may read it)`),
		`grai: "${key}" is in ${count(found.catalogs.length, "catalog")} and ${count(found.callSites.length, "call site")}${reaches > 0 ? `, and may be read at ${count(reaches, "other place")}` : ""}`,
	];
}

function foundLine(file: string, text: string, at: number): FoundLine {
	return { file, ...positionOf(text, at), text: lineAt(text, at) };
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
