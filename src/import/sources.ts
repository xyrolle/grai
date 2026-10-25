import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative } from "node:path";
import { type Config, isRecord } from "../config.ts";
import { GraiError } from "../error.ts";
import type { SourceEntry } from "./converted.ts";

/** A source file, as the report names it, the locale it holds, and its namespace: its name, when it sits in a locale's directory. */
export type Source = {
	path: string;
	file: string;
	locale: string;
	namespace: string;
};

/**
 * The JSON files of the inputs, files or directories, each with the configured locale it holds:
 * its name (`en.json`) or its directory's (`en/common.json`). A missing input, or a file whose
 * locale is neither, is an error.
 */
export function findSources(
	inputs: readonly string[],
	config: Config,
	errors: GraiError[],
): Source[] {
	return inputs.flatMap((input) => {
		if (existsSync(input)) {
			return filesIn(input).flatMap((path) => sourceOf(path, config, errors));
		}
		errors.push(
			new GraiError(
				"catalog-missing",
				{ file: relative(config.root, input) },
				"there is no such file or directory to import.",
			),
		);
		return [];
	});
}

/** A source file's messages, its nested objects flattened to paths. Unreadable JSON is an error. */
export function readEntries(
	source: Source,
	errors: GraiError[],
): SourceEntry[] {
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

function filesIn(input: string): string[] {
	if (!statSync(input).isDirectory()) return [input];
	return readdirSync(input, { recursive: true, encoding: "utf8" })
		.filter((name) => extname(name) === ".json")
		.sort()
		.map((name) => join(input, name));
}

function sourceOf(path: string, config: Config, errors: GraiError[]): Source[] {
	const name = basename(path, ".json");
	const parent = basename(dirname(path));
	const file = relative(config.root, path);
	if (config.locales.includes(name)) {
		return [{ path, file, locale: name, namespace: "" }];
	}
	if (config.locales.includes(parent)) {
		return [{ path, file, locale: parent, namespace: name }];
	}
	errors.push(
		new GraiError(
			"catalog-invalid",
			{ file },
			`its locale is unclear. Name the file <locale>.json, or put it in a <locale> directory, for a locale of the config: ${config.locales.join(", ")}.`,
		),
	);
	return [];
}

function flattened(
	value: Record<string, unknown>,
	path: readonly string[],
): SourceEntry[] {
	return Object.entries(value).flatMap(([name, item]) => {
		if (path.length === 0 && name === "$schema") return [];
		const at = [...path, name];
		// formatjs extracts a message as { defaultMessage, description }.
		if (!isRecord(item))
			return [{ path: at, value: item, description: undefined }];
		if (typeof item.defaultMessage !== "string") return flattened(item, at);
		const { defaultMessage, description } = item;
		return [
			{
				path: at,
				value: defaultMessage,
				description: typeof description === "string" ? description : undefined,
			},
		];
	});
}
