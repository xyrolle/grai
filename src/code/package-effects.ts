import { readFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { isMissing } from "../config.ts";
import { globMatcher, isGlob } from "../globs.ts";

/**
 * Whether a module keeps its side effects as its package declares them, as a bundler reads
 * `sideEffects` in the nearest package.json: every module does, but those it says do not, all of
 * them for `false`, or those no glob of its list matches. A glob without a `/` matches the file's
 * name in any directory, as webpack and Rollup read one; a glob grai cannot read keeps them.
 */
export class PackageEffects {
	private readonly declared = new Map<
		string,
		((path: string) => boolean) | undefined
	>();

	keeps(path: string): boolean {
		for (let directory = dirname(path); ; directory = dirname(directory)) {
			const keeps = this.declaredIn(directory);
			if (keeps !== undefined)
				return keeps(relative(directory, path).split(sep).join("/"));
			if (dirname(directory) === directory) return true;
		}
	}

	/**
	 * What a directory's package.json says of its modules' side effects, if it has one: a test of a
	 * module's path from the directory; undefined where there is none, for the one above to say.
	 */
	private declaredIn(
		directory: string,
	): ((path: string) => boolean) | undefined {
		if (this.declared.has(directory)) return this.declared.get(directory);
		const declared = sideEffectsOf(directory);
		this.declared.set(directory, declared);
		return declared;
	}
}

function sideEffectsOf(
	directory: string,
): ((path: string) => boolean) | undefined {
	let text: string;
	try {
		text = readFileSync(join(directory, "package.json"), "utf8");
	} catch (error) {
		if (isMissing(error)) return undefined;
		throw error;
	}
	const { sideEffects }: { sideEffects?: unknown } = JSON.parse(text);
	if (sideEffects === false) return () => false;
	if (!Array.isArray(sideEffects)) return () => true;
	const globs = sideEffects.filter(
		(glob): glob is string => typeof glob === "string",
	);
	if (!globs.every(isGlob)) return () => true;
	return globMatcher(
		globs.map((glob) =>
			glob.startsWith("./")
				? glob.slice(2)
				: glob.includes("/")
					? glob
					: `**/${glob}`,
		),
	);
}
