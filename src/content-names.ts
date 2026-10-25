import { createHash } from "node:crypto";

/**
 * How many hex digits of its content's hash a file's name carries: 48 bits, as many as Vite's
 * chunk names carry, so two contents of one file never meet under one name.
 */
const hashDigits = 12;

/**
 * A name made from content: `base-<hash of the texts>`. The same texts always give the same name.
 * The texts are hashed one after another, each ended by a NUL, rather than joined: a shard's are
 * a hundred kilobytes or more.
 */
export function contentName(base: string, ...texts: string[]): string {
	const digest = createHash("sha1");
	for (const text of texts) digest.update(text).update("\0");
	return `${base}-${digest.digest("hex").slice(0, hashDigits)}`;
}

/** The hash a content name carries, before the file's extension: `runtime-1f0c…js` has one. */
const nameHash = new RegExp(`-[0-9a-f]{${hashDigits}}(?=\\.)`);

/** A file's name without the hash of its content: `runtime-1f0c….js` is `runtime.js`. */
export function withoutContentHash(file: string): string {
	return file.replace(nameHash, "");
}

/**
 * A runtime module's source, with each import of a sibling module naming that module's file in
 * this output instead, so that the module and what it imports are of one output: a statement's
 * (`from "./config.js"`) and a JSDoc type's (`import("./runtime.js")`) alike. Every sibling a
 * source imports must be in `files`.
 */
export function pinImports(
	source: string,
	files: ReadonlyMap<string, string>,
): string {
	return source.replace(
		/(from |import\()"(\.\/[\w-]+\.js)"/g,
		(_, by: string, specifier: string) => {
			const file = files.get(specifier);
			if (file === undefined)
				throw new Error(
					`grai's runtime imports ${specifier}, which it pins to no file`,
				);
			return `${by}"./${file}"`;
		},
	);
}
