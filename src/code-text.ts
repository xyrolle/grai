/**
 * A source's code with what it does not run blanked to spaces, at the same offsets: comments, and
 * the text of string, template and regular-expression literals. A scan of it then finds no name a
 * literal or a comment only mentions. Two kinds of literal stay, as the scans read them: a module's
 * path, after `from` or `import` or as what a dynamic import or a Vite glob loads (`import("…")`,
 * `` import(`…${key}`) ``, `import.meta.glob("…")`), and a string in brackets, which reads a member
 * by name (`m["key"]`). A component's markup is left as it is, and only its scripts are blanked:
 * a Svelte, Vue or Astro `<script>`, and Astro's frontmatter.
 */

import {
	isIndexAfter,
	isPathAfter,
	passCode,
	passedNothing,
	passLiteral,
	startsRegex,
} from "./code-tokens.ts";
import { regexEnd, stringEnd, templateTextEnd } from "./literal-ends.ts";

const components = /\.(?:svelte|vue|astro)$/;
const scriptBlock = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---)/;
/** What can start a comment or a literal, and inside a template's `${}`, a brace too. */
const significantInCode = /[/"'`]/g;
const significantInTemplate = /[/"'`{}]/g;

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
 * last tokens of the code it passed, comments left out (`code-tokens.ts`).
 */
function blankedCode(source: string): string {
	let out = "";
	let index = 0;
	const passed = passedNothing(source);
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
		passCode(passed, index, at);
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
				passCode(passed, index, index + 1);
				keep(index + 1);
				continue;
			}
			const kept = isPathAfter(passed) || isIndexAfter(passed);
			passLiteral(passed, index);
			keep(index + 1);
			if (kept) keep(end - 1);
			else blank(index, end - 1);
			keep(end);
		} else if (char === "`" || (char === "}" && templates.at(-1) === 0)) {
			if (char === "}") templates.pop();
			const path = char === "`" && isPathAfter(passed);
			keep(index + 1);
			const end = templateTextEnd(source, index);
			if (path) keep(end);
			else blank(index, end);
			if (source.startsWith("${", end)) {
				passCode(passed, end + 1, end + 2);
				keep(end + 2);
				templates.push(0);
			} else {
				passLiteral(passed, end);
				keep(Math.min(end + 1, source.length));
			}
		} else if (char === "/" && startsRegex(passed)) {
			const { close, end } = regexEnd(source, index);
			passLiteral(passed, index);
			keep(index + 1);
			blank(index, close);
			keep(end);
		} else {
			// A `/` that divides, or a brace inside a template's `${}`.
			if (char !== "/") {
				const depth = templates.pop() ?? 0;
				templates.push(depth + (char === "{" ? 1 : -1));
			}
			passCode(passed, index, index + 1);
			keep(index + 1);
		}
	}
	return out;
}
