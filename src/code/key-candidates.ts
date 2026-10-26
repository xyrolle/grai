/**
 * Which source files may read or reach one key, by their text alone, for find and rename. A read of
 * a key by name writes its name; any other read or reach of it goes through a module that holds it,
 * `messages.js`, `keys.js` or a barrel that passes it on, so its text must hold what names one, as
 * for the whole output (`candidates.ts`). The test is necessary, never sufficient.
 */

import { basename, extname, isAbsolute } from "node:path";
import {
	type Link,
	nameOf,
	type Package,
	pathNames,
	written,
} from "./candidates.ts";
import type { Mapping } from "./mappings.ts";

/** What holds one key: the output's `messages.js` and `keys.js`, which hold every key, and barrels. */
export type Holders = {
	messages: string;
	keys: string;
	barrels: ReadonlySet<string>;
};

/**
 * A key path's tail, as a build reads one (`output-paths.ts`): a key's name, maybe with an
 * extension, at the end of the path. A path through a mapping to `keys.js` with such a tail names
 * that key's own module, which holds that key alone, and writes its name.
 */
const keyTail = "(?![A-Za-z_$][\\w$]*(?:\\.[cm]?[jt]s)?['\"`])";

/**
 * A path to `messages.js` or `keys.js`: their names as a segment that ends it, after `/` (or `\`),
 * with nothing of a further segment after them, so that no key's own path `…/messages/<key>.js`
 * passes for one.
 */
const outputModule = "[\\\\/](?:messages|keys)(?![\\w$/\\\\-])";

/**
 * Every name a file must write to read or reach one key, or undefined when a mapping may name a
 * holder from any specifier. That is the key's own name, which every read of it by name and its own
 * path write; or a name that may name a module that holds it: `messages.js` or `keys.js` by a path
 * segment that ends the path, never `messages/` on the way to another key's own path; a barrel that
 * holds it; or a mapping, symlink or package that leads to one of them, as for the whole output.
 */
export function keyNamesOf(
	key: string,
	holders: Holders,
	mappings: readonly Mapping[],
	links: readonly Link[],
	packages: readonly Package[],
): Set<string> | undefined {
	const files = [holders.messages, holders.keys, ...holders.barrels];
	const names = new Set([written(key), outputModule]);
	for (const barrel of holders.barrels) names.add(written(nameOf(barrel)));
	const lands = (path: string) => files.some((file) => pathNames(path, file));
	for (const { key: mapped, targets } of mappings) {
		const star = mapped.indexOf("*");
		const fixed = star === -1 ? mapped : mapped.slice(0, star);
		for (const target of targets) {
			if (!mapsToHolder(target, files, lands)) continue;
			if (fixed === "") return undefined;
			// A key's path through `…/messages/*` to keys.js names that key's module alone, by its name.
			const keyPaths =
				star !== -1 && target === holders.keys && fixed.endsWith("messages/");
			names.add(keyPaths ? `${written(fixed)}${keyTail}` : written(fixed));
		}
	}
	for (const { path, real } of links) {
		if (lands(real)) names.add(written(basename(path, extname(path))));
	}
	for (const { name, directory } of packages) {
		if (files.some((file) => file.startsWith(`${directory}/`))) {
			names.add(written(name));
		}
	}
	return names;
}

/**
 * Whether a mapping's target may name a holder without the specifier writing its file's name: a
 * specifier of its own, a path that names one, or one with `*` that names a segment past it or
 * splits a holder's name, as `*` takes the specifier's own text from the start of a segment.
 */
function mapsToHolder(
	target: string,
	files: readonly string[],
	lands: (path: string) => boolean,
): boolean {
	if (!isAbsolute(target)) return true;
	const star = target.indexOf("*");
	if (star === -1) return lands(target);
	if (target.slice(star + 1).includes("/")) return true;
	const fixed = target.slice(0, star);
	return !fixed.endsWith("/") && files.some((file) => file.startsWith(fixed));
}
