import {
	type MessageBindings,
	messageBindings,
	namespaceNames,
	readsNamespace,
	statementAt,
} from "./message-imports.ts";
import {
	after,
	before,
	nameEndingAt,
	occurrencesOf,
	type SourceFile,
} from "./sources.ts";

/**
 * What a key's name is where a source writes it: a read of the namespace (`m.key`, `m["key"]`), a
 * per-key import's path or name, a use of the name that import binds, or a mention that may mean
 * something else.
 */
export type UseKind = "member" | "bracket" | "import" | "binding" | "mention";

/** A place a source writes a key's name, which starts at `at`. */
export type Use = { at: number; kind: UseKind };

/** A file that writes a key's name: every place it does, and whether it binds the name to the key. */
export type FileUses = { source: SourceFile; uses: Use[]; bindsKey: boolean };

/** The files that write a key's name, each with every place it does. */
export function usesIn(files: readonly SourceFile[], key: string): FileUses[] {
	const namespaces = namespaceNames(files.map(({ text }) => text));
	return files
		.filter(({ text }) => text.includes(key))
		.map((source) => {
			const bindings = messageBindings(source.text, namespaces);
			const uses = occurrencesOf(source.text, key).map((at) => ({
				at,
				kind: kindOf(key, at, source.text, bindings),
			}));
			return { source, uses, bindsKey: bindings.keys.get(key) === key };
		})
		.filter(({ uses }) => uses.length > 0);
}

function kindOf(
	key: string,
	at: number,
	text: string,
	bindings: MessageBindings,
): UseKind {
	const statement = statementAt(bindings, at);
	if (statement !== undefined) {
		const inPath =
			statement.module.type === "key" &&
			statement.module.key === key &&
			at >= statement.specifier.at &&
			at < statement.specifier.at + statement.specifier.text.length;
		const isListedKey =
			(statement.module.type === "key" || statement.module.type === "keys") &&
			statement.names.some((listed) => listed.at === at);
		return inPath || isListedKey ? "import" : "mention";
	}
	if (isNamespaceMember(text, at, bindings)) return "member";
	if (isNamespaceIndex(text, at, key, bindings)) return "bracket";
	if (bindings.keys.get(key) === key && isReference(text, at, key)) {
		return "binding";
	}
	return "mention";
}

/** Whether the name follows `namespace.` or `namespace?.`. */
function isNamespaceMember(
	text: string,
	at: number,
	bindings: MessageBindings,
): boolean {
	const dot = before(text, at);
	if (text[dot] !== ".") return false;
	const access = text[dot - 1] === "?" ? dot - 1 : dot;
	return isNamespaceAt(text, before(text, access), bindings);
}

/** Whether the name is the whole of a string in `namespace["…"]`, `namespace['…']` or a plain template. */
function isNamespaceIndex(
	text: string,
	at: number,
	key: string,
	bindings: MessageBindings,
): boolean {
	const quote = text[at - 1] ?? "";
	if (!"\"'`".includes(quote) || text[at + key.length] !== quote) return false;
	const open = before(text, at - 1);
	if (text[open] !== "[" || text[after(text, at + key.length + 1)] !== "]") {
		return false;
	}
	const access = text.startsWith("?.", open - 2) ? open - 2 : open;
	return isNamespaceAt(text, before(text, access), bindings);
}

/**
 * Whether the name that ends at `end` is the namespace: a binding of it, or its property of a
 * namespace import of messages.js, and not a property of something else.
 */
function isNamespaceAt(
	text: string,
	end: number,
	bindings: MessageBindings,
): boolean {
	const name = nameEndingAt(text, end);
	const start = end - name.length + 1;
	return readsNamespace(text, start, name, bindings, true);
}

/** Characters around a reference to a binding, which no string or object key has around it. */
const opensReference = "([{,=:?!&|+-*/%<>~^;";
const closesReference = ")]},;.?:(=&|+-*/%<>!\r\n";
const keywordsBefore = new Set([
	"return",
	"typeof",
	"await",
	"void",
	"yield",
	"default",
	"case",
]);

/**
 * Whether the name reads a binding: it starts a line or follows an operator, a bracket or a
 * keyword, and ends one or precedes another, so it is neither in text nor after a dot. An object's
 * key or shorthand (`{ key }`, `key: …`) is no reference, since a rename would change the object.
 * `{key}` without spaces is a JSX or template expression.
 */
function isReference(text: string, at: number, key: string): boolean {
	const end = at + key.length;
	if (text[at - 1] === "{" && text[end] === "}") return true;
	const previous = text.charAt(before(text, at));
	const next = text[afterOnLine(text, end)] ?? "\n";
	const opened =
		startsLine(text, at) ||
		opensReference.includes(previous) ||
		keywordsBefore.has(nameEndingAt(text, before(text, at)));
	if (!opened || !closesReference.includes(next)) return false;
	const inObject =
		(previous === "{" || previous === ",") && "},:".includes(next);
	return !inObject;
}

/** Whether only whitespace stands before `at` on its line. */
function startsLine(text: string, at: number): boolean {
	const lineStart = text.lastIndexOf("\n", at - 1) + 1;
	return text.slice(lineStart, at).trim() === "";
}

/** Like `after`, but stopping at a line break, which ends a statement without a semicolon. */
function afterOnLine(text: string, at: number): number {
	let index = at;
	while (index < text.length && /[ \t]/.test(text[index] ?? "")) index++;
	return index;
}
