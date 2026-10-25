import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { type Use, usesIn } from "./call-sites.ts";
import type { Catalog } from "./catalog.ts";
import { type MessageEntry, messageEntries } from "./catalog-entries.ts";
import { keyOf, placedPath } from "./catalog-keys.ts";
import { layoutOf, tabbedLayout } from "./catalog-layout.ts";
import { withKeyRenamed, withMessages, withoutKeys } from "./catalog-text.ts";
import {
	type CompileResult,
	compile,
	parseCatalogs,
	readProject,
} from "./compile.ts";
import { withListedKeysChanged } from "./config-file.ts";
import { GraiError, type GraiErrorWhere, sortErrors } from "./error.ts";
import { isKeyName } from "./key-checks.ts";
import { reachProblems, siteProblems } from "./rename-checks.ts";
import { sourceFiles } from "./sources.ts";
import { writeAll } from "./write-all.ts";

/** What a rename changed, relative to the project's root, and what the compile after it wrote. */
export type RenameResult = CompileResult & { changed: string[] };

/**
 * Renames a key in every catalog, at every call site under the roots (the project's root by
 * default) and in the config's lists, all of them or none, then compiles. In an object of
 * messages, the key keeps its place while its new name still starts with the object's key. It
 * changes nothing when no catalog has the key, when the new name is no key name or is taken, or
 * when a source writes the key's name where it cannot tell that it means the key; each is an error
 * that names the place.
 */
export async function rename(
	configFile: string,
	from: string,
	to: string,
	roots?: readonly string[],
): Promise<RenameResult> {
	const read = await readProject(configFile);
	if ("errors" in read) return unchanged(read.errors);
	const { catalogs, errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return unchanged(errors);
	const { config } = read;
	const base = catalogs.find(({ locale }) => locale === config.baseLocale);
	const where = { file: base?.file ?? "", key: from };
	const named = nameProblems(from, to, catalogs, where);
	if (named.length > 0) return unchanged(named);
	const files = sourceFiles(roots ?? [config.root], config.root, config.outdir);
	const sites = usesIn(files, from);
	const problems = [
		...sites.flatMap((site) => siteProblems(site, from, to)),
		...reachProblems(files, from),
	];
	if (problems.length > 0) return unchanged(sortErrors(problems));
	const texts = new Map<string, string>();
	for (const [index, { file, bytes }] of read.sources.entries()) {
		const text = bytes.toString("utf8");
		const entry = messageEntries(text).find(({ path }) => keyOf(path) === from);
		const value = catalogs[index]?.messages.get(from);
		if (entry === undefined) continue;
		texts.set(join(config.root, file), renamedIn(text, entry, value, to, base));
	}
	for (const { source, uses } of sites) {
		texts.set(source.path, renamed(source.text, uses, from, to));
	}
	const configText = withListedKeysChanged(
		readFileSync(configFile, "utf8"),
		config.identicalToBase,
		(key) => (key === from ? to : key),
	);
	if (configText !== undefined) texts.set(resolve(configFile), configText);
	writeAll(texts);
	const changed = [...texts.keys()].map((path) => relative(config.root, path));
	return { ...(await compile(configFile)), changed };
}

/**
 * A catalog's text with a message renamed. It keeps its place when the new key still starts with
 * the key of the object it is in, then `_`, and takes the rest as its name there; else it moves to
 * where `grai add` puts a new key.
 */
function renamedIn(
	text: string,
	entry: MessageEntry,
	value: unknown,
	to: string,
	base: Catalog | undefined,
): string {
	const object = entry.path.slice(0, -1);
	const prefix = object.length === 0 ? "" : `${keyOf(object)}_`;
	if (to.length > prefix.length && to.startsWith(prefix)) {
		return withKeyRenamed(text, entry, to.slice(prefix.length));
	}
	const without = withoutKeys(text, new Set([keyOf(entry.path)]));
	const placed = placedPath(to, base?.paths.values() ?? []);
	return withMessages(
		without,
		[[placed, value]],
		layoutOf(without) ?? tabbedLayout,
	);
}

function unchanged(errors: GraiError[]): RenameResult {
	return { written: [], errors, changed: [] };
}

/** Why the key cannot take the new name: it is missing, the name is no key name, or it is taken. */
function nameProblems(
	from: string,
	to: string,
	catalogs: readonly Catalog[],
	where: GraiErrorWhere,
): GraiError[] {
	const keys = new Set(
		catalogs.flatMap(({ messages }) => [...messages.keys()]),
	);
	if (!keys.has(from)) {
		return [new GraiError("key-missing", where, "no catalog has the key.")];
	}
	if (!isKeyName(to)) {
		return [
			new GraiError(
				"key-invalid",
				where,
				`"${to}" is no key name: a key is a JavaScript identifier and not a reserved word.`,
			),
		];
	}
	const taken = [...keys].find(
		(key) => key !== from && key.toLowerCase() === to.toLowerCase(),
	);
	if (taken === undefined) return [];
	const collision =
		taken === to ? "" : `, which "${to}" would collide with, ignoring case`;
	return [
		new GraiError(
			"key-exists",
			where,
			`the catalogs have "${taken}" already${collision}. Choose another name.`,
		),
	];
}

/** The text with the key's name replaced by the new one at each use. */
function renamed(
	text: string,
	uses: readonly Use[],
	from: string,
	to: string,
): string {
	let result = "";
	let last = 0;
	for (const { at } of uses.toSorted((a, b) => a.at - b.at)) {
		result += text.slice(last, at) + to;
		last = at + from.length;
	}
	return result + text.slice(last);
}
