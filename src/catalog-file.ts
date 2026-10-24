/** Writing messages into a catalog file, in the layout it already has. */

import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { isRecord } from "./config.ts";

/**
 * Adds messages at the end of a catalog, through a temporary file renamed into place, keeping the
 * catalog's indent and its final line break. A catalog that does not exist yet is written in the
 * layout of `like`, another catalog of the project, with its `$schema`.
 */
export function appendMessages(
	path: string,
	messages: Iterable<readonly [string, unknown]>,
	like: string,
): void {
	const source = readFileSync(existsSync(path) ? path : like, "utf8");
	const parsed: unknown = JSON.parse(source);
	const before = isRecord(parsed) ? parsed : {};
	const catalog: Record<string, unknown> = existsSync(path)
		? { ...before }
		: "$schema" in before
			? { $schema: before.$schema }
			: {};
	for (const [key, value] of messages) catalog[key] = value;
	const indent = /\n([ \t]+)"/.exec(source)?.[1] ?? "";
	const ending = source.endsWith("\n") ? "\n" : "";
	writeFileSync(
		`${path}.tmp`,
		`${JSON.stringify(catalog, null, indent)}${ending}`,
	);
	renameSync(`${path}.tmp`, path);
}
