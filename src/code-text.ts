/**
 * A source's code with what it does not run blanked to spaces, at the same offsets: comments, and
 * the text of string, template and regular-expression literals. A scan of it then finds no name a
 * literal or a comment only mentions. Two kinds of string stay, as the scans read them: a module's
 * path after `from` or `import`, and a string in brackets, which reads a member by name
 * (`m["key"]`). A component's markup is left as it is, and only its scripts are blanked: a
 * Svelte, Vue or Astro `<script>`, and Astro's frontmatter.
 */

/** Words after which a `/` starts a regular expression, not a division. */
const beforeExpression = new Set([
	"return",
	"typeof",
	"instanceof",
	"case",
	"do",
	"else",
	"in",
	"of",
	"new",
	"delete",
	"void",
	"throw",
	"yield",
	"await",
]);
const components = /\.(?:svelte|vue|astro)$/;
const scriptBlock = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---)/;

/** A file's code, blanked as above. */
export function codeText(text: string, file: string): string {
	if (!components.test(file)) return blankedCode(text);
	const scripts = text.replace(
		scriptBlock,
		(_, open: string, body: string, close: string) =>
			open + blankedCode(body) + close,
	);
	return file.endsWith(".astro")
		? scripts.replace(
				frontmatter,
				(_, open: string, body: string, close: string) =>
					open + blankedCode(body) + close,
			)
		: scripts;
}

/** Whether a file's code writes an identifier with an escape, `title`, which no scan reads as the name. */
export function escapesNames(code: string): boolean {
	return /\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})/.test(code);
}

/** JavaScript or TypeScript with its comments and literals' text blanked. */
function blankedCode(source: string): string {
	let out = "";
	let index = 0;
	/** The last code the scan passed that is not space: a word, or one character. */
	let previous = "";
	/** For each template the code is inside: the depth of `{` in its `${}`. */
	const templates: number[] = [];
	const blank = (from: number, to: number) => {
		out += source.slice(from, to).replace(/[^\n]/g, " ");
		index = to;
	};
	const keep = (to: number) => {
		out += source.slice(index, to);
		index = to;
	};
	while (index < source.length) {
		const char = source.charAt(index);
		const next = source.charAt(index + 1);
		if (char === "/" && next === "/") {
			const end = source.indexOf("\n", index);
			blank(index, end === -1 ? source.length : end);
		} else if (char === "/" && next === "*") {
			const end = source.indexOf("*/", index + 2);
			blank(index, end === -1 ? source.length : end + 2);
		} else if (char === '"' || char === "'") {
			const end = stringEnd(source, index, char);
			if (end === undefined) {
				keep(index + 1);
				previous = char;
				continue;
			}
			const kept =
				previous === "[" || previous === "from" || previous === "import";
			keep(index + 1);
			if (kept) keep(end - 1);
			else blank(index, end - 1);
			keep(end);
			previous = "literal";
		} else if (char === "`" || (char === "}" && templates.at(-1) === 0)) {
			if (char === "}") templates.pop();
			keep(index + 1);
			const end = templateTextEnd(source, index);
			blank(index, end);
			if (source.startsWith("${", end)) {
				keep(end + 2);
				templates.push(0);
				previous = "{";
			} else {
				keep(Math.min(end + 1, source.length));
				previous = "literal";
			}
		} else if (char === "/" && startsExpression(previous)) {
			const { close, end } = regexEnd(source, index);
			keep(index + 1);
			blank(index, close);
			keep(end);
			previous = "literal";
		} else {
			if (templates.length > 0 && (char === "{" || char === "}")) {
				const depth = templates.pop() ?? 0;
				templates.push(depth + (char === "{" ? 1 : -1));
			}
			const word = /^[\w$]+/.exec(source.slice(index, index + 64))?.[0];
			if (word !== undefined) {
				keep(index + word.length);
				previous = word;
			} else {
				keep(index + 1);
				if (!/\s/.test(char)) previous = char;
			}
		}
	}
	return out;
}

/** The offset after a string's closing quote, or nothing when the line ends first, as in JSX text. */
function stringEnd(
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
function templateTextEnd(source: string, at: number): number {
	for (let index = at; index < source.length; index++) {
		const char = source.charAt(index);
		if (char === "\\") index++;
		else if (char === "`" || source.startsWith("${", index)) return index;
	}
	return source.length;
}

/** Where a regular expression's closing `/` is, and the offset after its flags. */
function regexEnd(
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

/**
 * Whether a `/` after this code starts a regular expression: after an operator or a keyword, but
 * not after `<`, where it closes a JSX element.
 */
function startsExpression(previous: string): boolean {
	if (previous === "" || beforeExpression.has(previous)) return true;
	if (previous === "<") return false;
	return previous.length === 1 && !/[\w$)\]}"'`]/.test(previous);
}
