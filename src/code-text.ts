/**
 * A source's code with what it does not run blanked to spaces, at the same offsets: comments, and
 * the text of string, template and regular-expression literals. A scan of it then finds no name a
 * literal or a comment only mentions. Two kinds of literal stay, as the scans read them: a module's
 * path, after `from` or `import` or as what a dynamic import or a Vite glob loads (`import("…")`,
 * `` import(`…${key}`) ``, `import.meta.glob("…")`), and a string in brackets, which reads a member
 * by name (`m["key"]`). A component's markup is left as it is, and only its scripts are blanked:
 * a Svelte, Vue or Astro `<script>`, and Astro's frontmatter.
 *
 * Without a parser, two kinds of place stay uncertain, and the scan says where they are, so that a
 * command that changes the sources refuses there: whatever it blanks in a file that may hold JSX,
 * whose text it reads as JavaScript (`<p>don't {m.title()}</p>`), and the rest of a line after a
 * `/` that follows `)` or `}`, which may start a regular expression or divide.
 */

import {
	isPathAfter,
	keepsString,
	mayStartRegex,
	passCode,
	passedNothing,
	passLiteral,
	startsRegex,
} from "./code-tokens.ts";
import { regexEnd, stringEnd, templateTextEnd } from "./literal-ends.ts";

/** A source's code, and the places in it the scan cannot read with certainty. */
export type CodeText = { code: string; uncertain: readonly Uncertain[] };

/**
 * A range the scan cannot read with certainty, and why: it may be JSX text, read as JavaScript, or
 * it follows a `/` that may start a regular expression.
 */
export type Uncertain = { at: number; end: number; why: "jsx" | "slash" };

const components = /\.(?:svelte|vue|astro)$/;
const scriptBlock = /(<script\b[^>]*>)([\s\S]*?)(<\/script\s*>)/gi;
const frontmatter = /^(---\r?\n)([\s\S]*?)(\r?\n---)/;
/** What can start a comment or a literal, and inside a template's `${}`, a brace too. */
const significantInCode = /[/"'`]/g;
const significantInTemplate = /[/"'`{}]/g;
/** Scripts that may be written in JSX, which hold it when they close a tag. */
const jsxScripts = /\.(?:[cm]?js|jsx|tsx)$/;
const closesTag = /<\/[\w.:-]*>|\/>/;

/** A file's code, blanked as above, and where the scan is uncertain. */
export function codeText(text: string, file: string): CodeText {
	if (!components.test(file)) {
		const jsx =
			file.endsWith(".mdx") || (jsxScripts.test(file) && closesTag.test(text));
		return blankedCode(text, 0, jsx);
	}
	const uncertain: Uncertain[] = [];
	const script = (open: string, body: string, close: string, at: number) => {
		const blanked = blankedCode(body, at + open.length, false);
		uncertain.push(...blanked.uncertain);
		return open + blanked.code + close;
	};
	const scripts = text.replace(
		scriptBlock,
		(_, open: string, body: string, close: string, at: number) =>
			script(open, body, close, at),
	);
	const code = file.endsWith(".astro")
		? scripts.replace(
				frontmatter,
				(_, open: string, body: string, close: string, at: number) =>
					script(open, body, close, at),
			)
		: scripts;
	return { code, uncertain };
}

/** The range of these the scan cannot read with certainty that an offset lies in, if any. */
export function uncertainAt(
	uncertain: readonly Uncertain[],
	at: number,
): Uncertain | undefined {
	return uncertain.find(({ at: start, end }) => start <= at && at < end);
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
function blankedCode(source: string, offset: number, jsx: boolean): CodeText {
	let out = "";
	const uncertain: Uncertain[] = [];
	let index = 0;
	const passed = passedNothing(source);
	/** For each template the code is inside: the depth of `{` in its `${}`. */
	const templates: number[] = [];
	const blank = (from: number, to: number) => {
		if (jsx && to > from) {
			uncertain.push({ at: offset + from, end: offset + to, why: "jsx" });
		}
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
			const kept = keepsString(passed);
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
			const closesElement = jsx && next === ">";
			if (char === "/" && mayStartRegex(passed) && !closesElement) {
				const { close } = regexEnd(source, index);
				const line = source.indexOf("\n", index);
				const end = line === -1 ? source.length : line;
				if (source.charAt(close) === "/") {
					uncertain.push({
						at: offset + index,
						end: offset + end,
						why: "slash",
					});
				}
			}
			if (char !== "/") {
				const depth = templates.pop() ?? 0;
				templates.push(depth + (char === "{" ? 1 : -1));
			}
			passCode(passed, index, index + 1);
			keep(index + 1);
		}
	}
	return { code: out, uncertain };
}
