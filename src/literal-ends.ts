/** Where a literal the code scan meets ends: a string, a template's text, or a regular expression. */

/** The offset after a string's closing quote, or nothing when the line ends first, as in JSX text. */
export function stringEnd(
	source: string,
	open: number,
	quote: string,
): number | undefined {
	for (let index = open + 1; index < source.length; index++) {
		const char = source.charAt(index);
		if (char === "\\") index++;
		else if (char === quote) return index + 1;
		else if (char === "\n") return undefined;
	}
	return undefined;
}

/** Where a template's text from `at` ends: at its closing backtick or its next `${`. */
export function templateTextEnd(source: string, at: number): number {
	for (let index = at; index < source.length; index++) {
		const char = source.charAt(index);
		if (char === "\\") index++;
		else if (char === "`" || source.startsWith("${", index)) return index;
	}
	return source.length;
}

/** Where a regular expression's closing `/` is, and the offset after its flags. */
export function regexEnd(
	source: string,
	open: number,
): { close: number; end: number } {
	let inClass = false;
	for (let index = open + 1; index < source.length; index++) {
		const char = source.charAt(index);
		if (char === "\\") index++;
		else if (char === "\n") return { close: index, end: index };
		else if (char === "[") inClass = true;
		else if (char === "]") inClass = false;
		else if (char === "/" && !inClass) {
			const flags = /^[a-z]*/.exec(source.slice(index + 1))?.[0] ?? "";
			return { close: index, end: index + 1 + flags.length };
		}
	}
	return { close: source.length, end: source.length };
}
