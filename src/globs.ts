/**
 * The config's globs, each compiled once into a regular expression. Node's `path.matchesGlob`
 * parses its glob again on every call: two globs over 9,000 source files take 110 ms with it, and
 * 2 ms compiled.
 * A glob has `*` (any characters but `/`), `**` (any number of directories), `?` (one character
 * but `/`) and `{a,b}` (any one of its choices), and matches a whole path, `/` between directories.
 */

/** Characters other glob dialects give meanings grai does not read: classes, groups, negation. */
const unsupported = /[[\]()!\\]/;

/** Whether a text is a glob grai reads: not empty, without other dialects' syntax, its braces paired. */
export function isGlob(text: string): boolean {
	return text !== "" && !unsupported.test(text) && hasPairedBraces(text);
}

/** Whether each `{` closes before the next one opens, and no `}` comes without one. */
function hasPairedBraces(text: string): boolean {
	let open = false;
	for (const char of text) {
		if (char === "{") {
			if (open) return false;
			open = true;
		} else if (char === "}") {
			if (!open) return false;
			open = false;
		}
	}
	return !open;
}

/** Whether a path matches any of the globs, which `isGlob` accepts. */
export function globMatcher(
	globs: readonly string[],
): (path: string) => boolean {
	const patterns = globs.map((glob) => new RegExp(`^${patternSource(glob)}$`));
	return (path) => patterns.some((pattern) => pattern.test(path));
}

/** A glob's regular expression, without its anchors. */
function patternSource(glob: string): string {
	let source = "";
	let index = 0;
	while (index < glob.length) {
		const startsSegment = index === 0 || glob[index - 1] === "/";
		if (startsSegment && glob.startsWith("**/", index)) {
			source += "(?:.*/)?";
			index += 3;
		} else if (glob.startsWith("**", index)) {
			source += ".*";
			index += 2;
		} else if (glob[index] === "{") {
			const end = glob.indexOf("}", index);
			const choices = glob.slice(index + 1, end).split(",");
			source += `(?:${choices.map(patternSource).join("|")})`;
			index = end + 1;
		} else {
			source += characterSource(glob.charAt(index));
			index += 1;
		}
	}
	return source;
}

function characterSource(char: string): string {
	if (char === "*") return "[^/]*";
	if (char === "?") return "[^/]";
	return char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
}
