import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMissing } from "./config.ts";
import { stateDirectory } from "./state-directory.ts";
import { saveState } from "./state-saves.ts";

/**
 * The groups of keys the output holds each in a module of its own, which an adapter saved from the
 * app's code (`@xyrolle/grai/next`, from its routes' reads): `.grai/groups.json`, beside the
 * manifest, a list of groups, each a list of keys.
 */
const groupsName = "groups.json";

/** The file an outdir's groups are saved in. */
export function groupsFile(outdir: string): string {
	return join(outdir, stateDirectory, groupsName);
}

/** Groups of keys, each a list of the keys it holds. */
export type KeyGroups = readonly (readonly string[])[];

/**
 * The groups saved for an outdir, or none. Groups out of date cost a page some keys, never a key:
 * one no group holds is in its hash's shard. So a file that is not a list of groups, as a crash in
 * a save could leave, is none, like a saved build that does not match.
 */
export function savedGroups(outdir: string): KeyGroups {
	let text: string;
	try {
		text = readFileSync(groupsFile(outdir), "utf8");
	} catch (error) {
		if (isMissing(error)) return [];
		throw error;
	}
	try {
		const groups: unknown = JSON.parse(text);
		return isKeyGroups(groups) ? groups : [];
	} catch {
		return [];
	}
}

/** Whether a value is groups of keys: a list of lists of keys. */
export function isKeyGroups(value: unknown): value is KeyGroups {
	return (
		Array.isArray(value) &&
		value.every(
			(group) =>
				Array.isArray(group) && group.every((key) => typeof key === "string"),
		)
	);
}

/** Saves the groups for an outdir's next compile, through a file of this save's own. */
export function saveGroups(outdir: string, groups: KeyGroups): Promise<void> {
	return saveState(
		join(outdir, stateDirectory),
		groupsName,
		`${JSON.stringify(groups)}\n`,
	);
}
