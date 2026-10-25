/**
 * A catalog's keys, with its objects of messages opened. A message's key is the names of the
 * objects it is in and its own, joined by `_`, as `grai import` names a nested key, so
 * `{ "cart": { "title": … } }` holds `cart_title`. A message is a string or an array; any other
 * object holds messages.
 */

import { isRecord } from "./config.ts";
import { GraiError } from "./error.ts";

/** Where a message is in its catalog: the names of the objects it is in, then its own. */
export type KeyPath = readonly string[];

/** A catalog's messages by key, and the path each key is at in its file. */
export type CatalogKeys = {
	messages: Map<string, unknown>;
	paths: Map<string, KeyPath>;
};

/** The key the format reserves for the catalog's JSON schema; it is not a message. */
export const schemaKey = "$schema";

/** The key a path names. */
export function keyOf(path: KeyPath): string {
	return path.join("_");
}

/** The fields of a message with variants, which an object of messages does not have alone. */
const variantFields = new Set(["declarations", "selectors", "match"]);

/**
 * The messages of a catalog's object, its objects of messages opened. Two paths that name one key
 * are an error, and so is a message with variants that is not in an array.
 */
export function catalogKeys(
	object: Readonly<Record<string, unknown>>,
	where: { file: string; locale: string },
): CatalogKeys {
	const keys: CatalogKeys = { messages: new Map(), paths: new Map() };
	const open = (within: KeyPath, value: Readonly<Record<string, unknown>>) => {
		for (const name in value) {
			if (within.length === 0 && name === schemaKey) continue;
			const path = [...within, name];
			const entry = value[name];
			if (isRecord(entry)) {
				if (isVariants(entry)) throw unwrapped(path, where);
				open(path, entry);
			} else {
				add(keys, path, entry, where);
			}
		}
	};
	open([], object);
	return keys;
}

function add(
	{ messages, paths }: CatalogKeys,
	path: KeyPath,
	value: unknown,
	where: { file: string; locale: string },
): void {
	const key = keyOf(path);
	const other = paths.get(key);
	if (other !== undefined) {
		throw new GraiError(
			"key-invalid",
			{ ...where, key },
			`${written(other)} and ${written(path)} both name the key ${key}, as nested keys are joined by _. Rename one.`,
		);
	}
	messages.set(key, value);
	paths.set(key, path);
}

/** Whether any of a catalog's keys is in an object of messages. */
export function hasObjects(paths: Iterable<KeyPath>): boolean {
	for (const path of paths) if (path.length > 1) return true;
	return false;
}

/** A path as a catalog's reader thinks of it: `cart.title`. */
export function written(path: KeyPath): string {
	return path.join(".");
}

function isVariants(object: Readonly<Record<string, unknown>>): boolean {
	const fields = Object.keys(object);
	return (
		fields.includes("match") &&
		fields.every((field) => variantFields.has(field))
	);
}

function unwrapped(
	path: KeyPath,
	where: { file: string; locale: string },
): GraiError {
	return new GraiError(
		"message-invalid",
		{ ...where, key: keyOf(path) },
		`${written(path)} is a message with variants, which the format writes as an array of one object. Wrap it in [ ].`,
	);
}
