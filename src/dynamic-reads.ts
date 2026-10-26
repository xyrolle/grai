import {
	type MessageBindings,
	readsNamespace,
	statementAt,
} from "./message-imports.ts";
import { declaresAt } from "./redeclarations.ts";
import { after, occurrencesOf } from "./sources.ts";

/** A read of the namespace by a name the source computes: it may reach the keys that start with `prefix`, any key for "". */
export type DynamicRead = { at: number; written: string; prefix: string };

/**
 * A load of per-key modules by a built path: `` import(`…/messages/${key}.js`) ``, an import of
 * `"…/messages/" + key`, or a Vite glob over them.
 */
const builtPerKeyLoad =
	/\bimport\s*\(\s*(["'`])[^"'`\r\n]*\/messages\/(?:\$\{|\1\s*\+)|\bimport\.meta\.glob\s*\(\s*["'`][^"'`\r\n]*\/messages\//g;
/** An index that names no key, or names one in full: a number, a string, a template without `${`. */
const writtenIndex = /^\s*(?:\d+|"[^"\\]*"|'[^'\\]*'|`[^`\\$]*`)\s*$/;
/**
 * The indexes whose literal start bounds the keys they reach: a template that starts with text, and
 * text joined to one name or property. Any other, such as a choice or a longer sum, may reach any key.
 */
const templatePrefix = /^\s*`([^`\\$]*)\$\{[^`]*`\s*$/;
const concatenatedPrefix =
	/^\s*(["'])([^"'\\]*)\1\s*\+\s*[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*$/;
/** How far an index is read; one longer than that may name any key. */
const longestIndex = 500;

/**
 * Each place a file reads the namespace by a computed name, `m[name]`, or uses it whole, as in
 * `Object.keys(m)` or `typeof m`, also through a wrapper (`messages.m[name]`); each use of a
 * namespace import of messages.js whole; and each load of per-key modules by a built path. Such a
 * read may name keys no source writes, so a key it may reach is never proven unused.
 */
export function dynamicReadsIn(
	text: string,
	bindings: MessageBindings,
): DynamicRead[] {
	const reads: DynamicRead[] = [];
	const wrapped = bindings.wrappers.size > 0 ? bindings.namespaceNames : [];
	for (const name of new Set([...bindings.namespaces, ...wrapped])) {
		for (const at of occurrencesOf(text, name)) {
			const read = readAt(text, at, name, bindings);
			if (read !== undefined) reads.push(read);
		}
	}
	for (const [name, module] of bindings.wrappers) {
		if (module !== "messages") continue;
		for (const at of occurrencesOf(text, name)) {
			const whole = statementAt(bindings, at) === undefined;
			if (whole && text[after(text, at + name.length)] !== ".") {
				reads.push({ at, written: name, prefix: "" });
			}
		}
	}
	for (const match of text.matchAll(builtPerKeyLoad)) {
		// A comment in the call is blanked in the code, so its space is shown as one.
		const written = match[0].replace(/\s+/g, " ");
		reads.push({ at: match.index, written, prefix: "" });
	}
	return reads;
}

/** The read the namespace's name starts at `at`, unless it names its key in full or is no read. */
function readAt(
	text: string,
	at: number,
	name: string,
	bindings: MessageBindings,
): DynamicRead | undefined {
	const declared =
		statementAt(bindings, at) !== undefined ||
		bindings.reexports.some(({ start, end }) => start <= at && at < end);
	if (declared || !readsNamespace(text, at, name, bindings, false)) {
		return undefined;
	}
	const next = after(text, at + name.length);
	const optional = text.startsWith("?.", next);
	const open = optional ? after(text, next + 2) : next;
	const namesKey = text[next] === "." || (optional && text[open] !== "[");
	if (namesKey) return undefined;
	if (text[open] !== "[") {
		// A parameter or local of the same name declares another m, which reads nothing of these.
		if (declaresAt(text, at, name)) return undefined;
		return { at, written: name, prefix: "" };
	}
	const index = indexAt(text, open);
	if (index !== undefined && writtenIndex.test(index)) return undefined;
	const prefix =
		index === undefined
			? ""
			: (templatePrefix.exec(index)?.[1] ??
				concatenatedPrefix.exec(index)?.[2] ??
				"");
	return { at, written: `${name}[${index ?? "…"}]`, prefix };
}

/** The text between a `[` and its `]`, or undefined when it does not close within `longestIndex`. */
function indexAt(text: string, open: number): string | undefined {
	let depth = 0;
	for (
		let index = open;
		index < text.length && index - open < longestIndex;
		index++
	) {
		const char = text.charAt(index);
		if ("([{".includes(char)) depth++;
		if (")]}".includes(char)) depth--;
		if (depth === 0) return text.slice(open + 1, index);
	}
	return undefined;
}
