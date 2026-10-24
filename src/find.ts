import { usesIn } from "./call-sites.ts";
import { catalogEntries } from "./catalog-entries.ts";
import { parseCatalogs, readProject } from "./compile.ts";
import { GraiError } from "./error.ts";
import { lineAt, positionOf, sourceFiles } from "./sources.ts";

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
	/** Each call site: `m.key`, `m["key"]`, a per-key import, or a use of the name it binds. */
	callSites: FoundLine[];
	/** Each other place a source writes the key's name, which may mean something else. */
	mentions: FoundLine[];
	errors: GraiError[];
};

/**
 * Every place a key is: its entry in each catalog, and each place the source files under the
 * roots (the project's root by default) write its name. A key no catalog has is an error.
 */
export async function find(
	configFile: string,
	key: string,
	roots?: readonly string[],
): Promise<FindResult> {
	const found: FindResult = {
		catalogs: [],
		callSites: [],
		mentions: [],
		errors: [],
	};
	const read = await readProject(configFile);
	if ("errors" in read) return { ...found, errors: read.errors };
	const { errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return { ...found, errors };
	for (const { file, bytes } of read.sources) {
		const text = bytes.toString("utf8");
		const entry = catalogEntries(text).find((other) => other.key === key);
		if (entry !== undefined) {
			found.catalogs.push(foundLine(file, text, entry.keyStart));
		}
	}
	const { config } = read;
	const files = sourceFiles(roots ?? [config.root], config.root, config.outdir);
	for (const { source, uses } of usesIn(files, key)) {
		for (const { at, kind } of uses) {
			const place = foundLine(source.file, source.text, at);
			if (kind === "mention") found.mentions.push(place);
			else found.callSites.push(place);
		}
	}
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

/** What find prints: each place as `file:line:column: text`, a mention marked, then a count. */
export function foundLines(key: string, found: FindResult): string[] {
	const place = ({ file, line, column, text }: FoundLine) =>
		`${file}:${line}:${column}: ${text.trim()}`;
	const mentions = found.mentions.length;
	return [
		...found.catalogs.map(place),
		...found.callSites.map(place),
		...found.mentions.map((mention) => `${place(mention)} (not a call site)`),
		`grai: "${key}" is in ${count(found.catalogs.length, "catalog")} and ${count(found.callSites.length, "call site")}${mentions > 0 ? `, and named in ${count(mentions, "other place")}` : ""}`,
	];
}

function foundLine(file: string, text: string, at: number): FoundLine {
	return { file, ...positionOf(text, at), text: lineAt(text, at) };
}

function count(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
}
