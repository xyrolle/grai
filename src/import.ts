import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { isKeyName } from "./compilation.ts";
import { type Config, isRecord, readConfig } from "./config.ts";
import {
	type CatalogValue,
	catalogValue,
	type ImportedMessage,
	type SourceEntry,
} from "./converted.ts";
import { GraiError, sortErrors } from "./error.ts";
import { convertI18next } from "./i18next.ts";
import { parseMessage } from "./message.ts";
import { MessageProblem } from "./problem.ts";

/** The libraries whose catalogs grai imports. */
export const importFormats = ["i18next"] as const;
export type ImportFormat = (typeof importFormats)[number];

/** A message the import left out or changed: its source file and key as the source names them, and the locales it is about. */
export type ImportNotice = {
	file: string;
	key: string;
	locales: readonly string[];
	detail: string;
};

export type ImportResult = {
	/** The catalogs written: none when there are errors. */
	written: string[];
	/** How many keys each catalog got. */
	keys: number;
	/** Messages not imported, in any locale, with the reason. */
	leftOut: ImportNotice[];
	/** Messages imported that render differently than in the source library. */
	changed: ImportNotice[];
	errors: GraiError[];
};

/** A source file, the locale it holds, and its namespace: its name, when it sits in a locale's directory. */
type Source = { path: string; file: string; locale: string; namespace: string };

/** A converted message, where it came from, and its grai key. */
type Found = ImportedMessage & { file: string; key: string; name: string };

const schema = "https://inlang.com/schema/inlang-message-format";

/**
 * Converts another library's catalogs into the project's grai catalogs, which must not exist yet.
 * A message that cannot be converted in some locale is left out of every locale and reported, so
 * the catalogs compile. An unreadable source, a file whose locale is unclear, two keys that become
 * one, or a catalog that exists already is an error, and then nothing is written.
 */
export function importCatalogs(
	configFile: string,
	format: ImportFormat,
	inputs: readonly string[],
): ImportResult {
	const result: ImportResult = {
		written: [],
		keys: 0,
		leftOut: [],
		changed: [],
		errors: [],
	};
	let config: Config;
	try {
		config = readConfig(configFile);
	} catch (error) {
		if (!(error instanceof GraiError)) throw error;
		return { ...result, errors: [error] };
	}
	const shown = (path: string) => relative(config.root, path) || ".";
	const sources = inputs.flatMap((input) =>
		sourcesIn(input, config, shown, result.errors),
	);
	const namespaced =
		new Set(sources.map((source) => source.namespace)).size > 1;
	const found = new Map<string, Map<string, Found>>(
		config.locales.map((locale) => [locale, new Map()]),
	);
	/** The source keys each grai key, ignoring case, comes from. */
	const named = new Map<string, Map<string, Found>>();
	for (const source of sources) {
		const entries = entriesOf(source, result.errors);
		const messages = convertI18next(entries, source.locale);
		const namespace =
			namespaced && source.namespace !== "" ? [source.namespace] : [];
		for (const message of messages) {
			const key = `${namespace.map((name) => `${name}:`).join("")}${message.path.join(".")}`;
			const name = keyNameOf([...namespace, ...message.path]);
			const at = { ...message, file: source.file, key, name };
			found.get(source.locale)?.set(name, at);
			const sourceKeys =
				named.get(name.toLowerCase()) ?? new Map<string, Found>();
			if (!sourceKeys.has(key)) sourceKeys.set(key, at);
			named.set(name.toLowerCase(), sourceKeys);
		}
	}
	result.errors.push(...collisions(named));
	const catalogs = new Map<string, Record<string, CatalogValue>>(
		config.locales.map((locale) => [locale, { $schema: schema }]),
	);
	for (const key of keysInOrder(found, config.baseLocale)) {
		const values = valuesOf(key, found, result);
		if (values === undefined) continue;
		for (const [locale, value] of values) {
			const catalog = catalogs.get(locale);
			if (catalog !== undefined) catalog[key] = value;
		}
		result.keys++;
	}
	for (const [locale, path] of config.catalogs) {
		if (existsSync(path)) {
			result.errors.push(
				new GraiError(
					"catalog-exists",
					{ file: shown(path), locale },
					"the catalog exists already, and import writes new catalogs only. Move it away, or point catalogs elsewhere in the config.",
				),
			);
		}
	}
	if (result.keys === 0 && result.errors.length === 0) {
		result.errors.push(
			new GraiError(
				"catalog-empty",
				{ file: shown(configFile) },
				"no message could be imported. The messages left out say why.",
			),
		);
	}
	if (result.errors.length > 0)
		return { ...result, errors: sortErrors(result.errors) };
	for (const [locale, path] of config.catalogs) {
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			`${path}.tmp`,
			`${JSON.stringify(catalogs.get(locale), null, "\t")}\n`,
		);
		renameSync(`${path}.tmp`, path);
		result.written.push(shown(path));
	}
	return result;
}

/** The JSON files of an input, a file or a directory, each with the configured locale it holds. */
function sourcesIn(
	input: string,
	config: Config,
	shown: (path: string) => string,
	errors: GraiError[],
): Source[] {
	if (!existsSync(input)) {
		errors.push(
			new GraiError(
				"catalog-missing",
				{ file: shown(input) },
				"there is no such file or directory to import.",
			),
		);
		return [];
	}
	const files = statSync(input).isDirectory()
		? readdirSync(input, { recursive: true, encoding: "utf8" })
				.filter((name) => extname(name) === ".json")
				.sort()
				.map((name) => join(input, name))
		: [input];
	return files.flatMap((path): Source[] => {
		const name = basename(path, ".json");
		const parent = basename(dirname(path));
		const file = shown(path);
		if (config.locales.includes(name))
			return [{ path, file, locale: name, namespace: "" }];
		if (config.locales.includes(parent))
			return [{ path, file, locale: parent, namespace: name }];
		errors.push(
			new GraiError(
				"catalog-invalid",
				{ file },
				`its locale is unclear. Name the file <locale>.json, or put it in a <locale> directory, for a locale of the config: ${config.locales.join(", ")}.`,
			),
		);
		return [];
	});
}

/** A source file's messages, its nested objects flattened to paths. */
function entriesOf(source: Source, errors: GraiError[]): SourceEntry[] {
	let value: unknown;
	try {
		value = JSON.parse(readFileSync(source.path, "utf8"));
	} catch (error) {
		errors.push(
			new GraiError(
				"catalog-invalid",
				{ file: source.file },
				`it cannot be read as JSON: ${String(error)}.`,
			),
		);
		return [];
	}
	if (!isRecord(value)) {
		errors.push(
			new GraiError(
				"catalog-invalid",
				{ file: source.file },
				"it must hold a JSON object of messages.",
			),
		);
		return [];
	}
	return flattened(value, []);
}

function flattened(
	value: Record<string, unknown>,
	path: readonly string[],
): SourceEntry[] {
	return Object.entries(value).flatMap(([name, item]) => {
		if (path.length === 0 && name === "$schema") return [];
		const at = [...path, name];
		return isRecord(item) ? flattened(item, at) : [{ path: at, value: item }];
	});
}

/**
 * A grai key from a source path: its segments joined by `_`, every character a JavaScript
 * identifier cannot hold as `_`, a leading digit after a `_`, and a reserved word followed by one.
 */
export function keyNameOf(path: readonly string[]): string {
	const name = path.join("_").replace(/[^\w$]/g, "_");
	const identifier = /^\d/.test(name) ? `_${name}` : name;
	return isKeyName(identifier) ? identifier : `${identifier}_`;
}

/** Source keys that become one grai key, or keys that differ only in case, as errors. */
function collisions(
	named: ReadonlyMap<string, ReadonlyMap<string, Found>>,
): GraiError[] {
	return [...named]
		.filter(([, sourceKeys]) => sourceKeys.size > 1)
		.map(([, sourceKeys]) => {
			const [first] = sourceKeys.values();
			return new GraiError(
				"key-invalid",
				{ file: first?.file ?? "", key: first?.key ?? "" },
				`the keys ${[...sourceKeys.keys()].join(", ")} all become the grai key ${first?.name ?? ""}, ignoring case. Rename all but one in the source.`,
			);
		});
}

/** Every key, the base locale's in its order first. */
function keysInOrder(
	found: ReadonlyMap<string, ReadonlyMap<string, Found>>,
	baseLocale: string,
): Set<string> {
	const keys = new Set(found.get(baseLocale)?.keys());
	for (const messages of found.values())
		for (const key of messages.keys()) keys.add(key);
	return keys;
}

/** A key's catalog value in each locale, or nothing, with the reasons in `leftOut`, when a locale lacks or cannot convert it. */
function valuesOf(
	key: string,
	found: ReadonlyMap<string, ReadonlyMap<string, Found>>,
	result: ImportResult,
): Map<string, CatalogValue> | undefined {
	const values = new Map<string, CatalogValue>();
	const messages = [...found].map(([locale, byKey]) => ({
		locale,
		message: byKey.get(key),
	}));
	const source = messages.find(({ message }) => message !== undefined)?.message;
	const leftOut = new Notices(source?.file ?? "", source?.key ?? key);
	for (const { locale, message } of messages) {
		if (message === undefined) {
			leftOut.add(
				locale,
				"it has no message in this locale, and every key needs one in each locale.",
			);
			continue;
		}
		try {
			if (message.result instanceof MessageProblem) throw message.result;
			const value = catalogValue(message.result);
			parseMessage(locale, value);
			values.set(locale, value);
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			leftOut.add(locale, error.message);
		}
	}
	if (leftOut.size > 0) {
		result.leftOut.push(...leftOut.list());
		return undefined;
	}
	const changed = new Notices(source?.file ?? "", source?.key ?? key);
	for (const { locale, message } of messages) {
		for (const detail of message?.notes ?? []) changed.add(locale, detail);
	}
	result.changed.push(...changed.list());
	return values;
}

/** One key's notices, each detail once with every locale it is about. */
class Notices {
	private readonly locales = new Map<string, string[]>();
	private readonly file: string;
	private readonly key: string;

	constructor(file: string, key: string) {
		this.file = file;
		this.key = key;
	}

	get size(): number {
		return this.locales.size;
	}

	add(locale: string, detail: string) {
		this.locales.set(detail, [...(this.locales.get(detail) ?? []), locale]);
	}

	list(): ImportNotice[] {
		return [...this.locales].map(([detail, locales]) => ({
			file: this.file,
			key: this.key,
			locales,
			detail,
		}));
	}
}
