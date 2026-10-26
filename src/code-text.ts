/**
 * A source's code with what it does not run blanked to spaces, at the same offsets: comments, and
 * the text of string, template and regular-expression literals. A scan of it then finds no name a
 * literal or a comment only mentions. Two kinds of literal stay, as the scans read them: a module's
 * path, after `from` or `import` or as what a dynamic import or a Vite glob loads (`import("…")`,
 * `` import(`…${key}`) ``, `import.meta.glob("…")`), and a string in brackets, which reads a member
 * by name (`m["key"]`). A component's markup is left as it is, and only its scripts are blanked:
 * a Svelte, Vue or Astro `<script>`, and Astro's frontmatter.
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
import { regexEnd, stringEnd, templateTextEnd } from "./literal-ends.ts";

const components = /\.(?:svelte|vue|astro)$/;
const scriptBlock = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---)/;
/** What can start a comment or a literal, and inside a template's `${}`, a brace too. */
const significantInCode = /[/"'`]/g;
const significantInTemplate = /[/"'`{}]/g;
/** The end of code that opens a dynamic import or a Vite glob, whose argument is a module's path. */
const opensLoad = /(?<![\w$.])import\s*(?:\.\s*meta\s*\.\s*glob\s*)?\(\s*$/;

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

/** Whether a file's code writes an identifier with an escape, `t\u0069tle`, which no scan reads as the name. */
export function escapesNames(code: string): boolean {
	return /\\u(?:[0-9a-fA-F]{4}|\{[0-9a-fA-F]+\})/.test(code);
}

/**
 * JavaScript or TypeScript with its comments and literals' text blanked. The scan goes from one
 * character that can start a comment or a literal to the next, and reads a `/` or a quote by the
 * word or character the code it went past ends with.
 */
function blankedCode(source: string): string {
	let out = "";
	let index = 0;
	/** The last code the scan passed that is not space: a word, or one character. */
	let previous = "";
	/** For each template the code is inside: the depth of `{` in its `${}`. */
	const templates: number[] = [];
	const blank = (from: number, to: number) => {
		const text = source.slice(from, to);
		out += text.includes("\n")
			? text.replace(/[^\n]/g, " ")
			: " ".repeat(text.length);
		index = to;
	};
	const keep = (to: number) => {
		out += source.slice(index, to);
		index = to;
	};
	while (index < source.length) {
		const significant =
			templates.length > 0 ? significantInTemplate : significantInCode;
		significant.lastIndex = index;
		const at = significant.exec(source)?.index ?? source.length;
		const passed = source.slice(index, at);
		previous = lastWritten(passed) ?? previous;
		const path =
			previous === "from" ||
			previous === "import" ||
			(previous === "(" && opensLoad.test(passed));
		keep(at);
		if (index === source.length) break;
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
			keep(index + 1);
			if (path || previous === "[") keep(end - 1);
			else blank(index, end - 1);
			keep(end);
			previous = "literal";
		} else if (char === "`" || (char === "}" && templates.at(-1) === 0)) {
			if (char === "}") templates.pop();
			keep(index + 1);
			const end = templateTextEnd(source, index);
			if (char === "`" && path) keep(end);
			else blank(index, end);
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
			// A `/` that divides, or a brace inside a template's `${}`.
			if (char !== "/") {
				const depth = templates.pop() ?? 0;
				templates.push(depth + (char === "{" ? 1 : -1));
			}
			keep(index + 1);
			previous = char;
		}
	}
	return out;
}

/** The last word, or character other than space, that code writes, if it writes any. */
function lastWritten(code: string): string | undefined {
	const written = code.trimEnd();
	let start = written.length;
	while (start > 0 && /[\w$]/.test(written.charAt(start - 1))) start--;
	return start < written.length ? written.slice(start) : written.at(-1);
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
