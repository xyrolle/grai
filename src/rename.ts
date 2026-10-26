import { readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { type Catalog, fileOfKey, pathsInFile } from "./catalog.ts";
import { type MessageEntry, messageEntries } from "./catalog-entries.ts";
import { type KeyPath, keyOf, placedPath } from "./catalog-keys.ts";
import { layoutOf, tabbedLayout } from "./catalog-layout.ts";
import { withKeyRenamed, withMessages, withoutKeys } from "./catalog-text.ts";
import { readProjectCode } from "./code/project.ts";
import { readingOf } from "./code/reads.ts";
import { codeProblems, unknownReads } from "./code-problems.ts";
import {
	type CompileResult,
	compile,
	parseCatalogs,
	readProject,
} from "./compile.ts";
import { withListedKeysChanged } from "./config-file.ts";
import { descriptionsRenamed } from "./descriptions.ts";
import { GraiError, type GraiErrorWhere, sortErrors } from "./error.ts";
import { isKeyName } from "./key-checks.ts";
import { compileOutputIfMissing } from "./output-present.ts";
import { realPath } from "./real-path.ts";
import { codeEdits, edited } from "./rename-edits.ts";
import { writeAll } from "./write-all.ts";

/** What a rename changed, relative to the project's root, and what the compile after it wrote. */
export type RenameResult = CompileResult & { changed: string[] };

/**
 * Renames a key in every catalog, at every read of it in the code under the roots (the project's
 * root by default), read as `check` reads it, in the config's lists and in the descriptions file,
 * all of them or none, then compiles. A binding named after the key is renamed with it, with every
 * reference to it. In an object of messages, the key keeps its place while its new name still
 * starts with the object's key. It changes nothing when no catalog has the key, when the new name
 * is no key name or another key's, when a read may reach the key without naming it, when a binding
 * cannot take the new name, or when a file's reads cannot be known; each is an error at its place.
 */
export async function rename(
	configFile: string,
	from: string,
	to: string,
	roots?: readonly string[],
): Promise<RenameResult> {
	const read = await readProject(configFile);
	if ("errors" in read) return unchanged(read.errors);
	const { parts, catalogs, errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return unchanged(errors);
	const { config } = read;
	const base = catalogs.find(({ locale }) => locale === config.baseLocale);
	const where = {
		file: base === undefined ? "" : fileOfKey(base, from),
		key: from,
	};
	const named = nameProblems(from, to, catalogs, where);
	if (named.length > 0) return unchanged(named);
	const compiled = await compileOutputIfMissing(configFile, config);
	if (compiled.length > 0) return unchanged([...compiled]);
	const code = await readProjectCode(config, roots ?? [config.root], from);
	if (code instanceof GraiError) return unchanged([code]);
	const reading = await readingOf(code);
	const keys = new Set(
		catalogs.flatMap(({ messages }) => [...messages.keys()]),
	);
	const unknown = unknownReads(codeProblems(reading, keys, config));
	if (unknown.length > 0) return unchanged(unknown);
	const { files, problems } = await codeEdits(reading, from, to);
	if (problems.length > 0) return unchanged(sortErrors(problems));
	const texts = new Map<string, string>();
	for (const [index, { file, files, bytes }] of read.sources.entries()) {
		const text = bytes.toString("utf8");
		const entry = messageEntries(text).find(({ path }) => keyOf(path) === from);
		const value = parts[index]?.messages.get(from);
		if (entry === undefined) continue;
		// A key that moves goes where `grai add` puts it in this file, among the base's keys in its file.
		const siblings =
			base === undefined ? [] : pathsInFile(base, files.indexOf(file));
		texts.set(
			join(config.root, file),
			renamedIn(text, entry, value, to, siblings),
		);
	}
	for (const [path, { text, edits }] of files) {
		texts.set(path, edited(text, edits, to));
	}
	const configText = withListedKeysChanged(
		readFileSync(configFile, "utf8"),
		config.identicalToBase,
		(key) => (key === from ? to : key),
	);
	if (configText !== undefined) texts.set(resolve(configFile), configText);
	const described = descriptionsRenamed(config, from, to);
	if (described !== undefined) texts.set(described.file, described.text);
	writeAll(texts);
	// The code's files are named by their real paths, as the bundler names them, so each file and the
	// root are taken by theirs to name a file as the project does.
	const root = realPath(config.root);
	const changed = [...texts.keys()].map((path) =>
		relative(root, realPath(path)),
	);
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
	siblings: Iterable<KeyPath>,
): string {
	const object = entry.path.slice(0, -1);
	const prefix = object.length === 0 ? "" : `${keyOf(object)}_`;
	if (to.length > prefix.length && to.startsWith(prefix)) {
		return withKeyRenamed(text, entry, to.slice(prefix.length));
	}
	const without = withoutKeys(text, new Set([keyOf(entry.path)]));
	const placed = placedPath(to, siblings);
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
