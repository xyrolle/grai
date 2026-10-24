/** What a page's document starts with: its `<html>`'s `lang` and `dir`, and what opens its head. */
export type DocumentStart = { lang: string; dir: "ltr" | "rtl"; head: string };

/**
 * A page's bytes with its document's start rewritten: the `<html>` start tag's `lang` and `dir`
 * set to the page's, its other attributes as written, and `head` placed first in the head. Only
 * the start is read; every byte after it passes through as it comes, so the page still streams. A
 * body that is not a whole document, such as a partial, passes through as it is.
 */
export function rewriteDocumentStart(
	body: ReadableStream<Uint8Array>,
	start: DocumentStart,
): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	let read = new Uint8Array(0);
	let passing = false;
	/** Sends the start as `split` rewrites it, then the bytes after it as they were read. */
	const send = (
		controller: TransformStreamDefaultController<Uint8Array>,
		text: string,
		split: Split,
	) => {
		const rewritten = encoder.encode(split.rewrite(start));
		const consumed = encoder.encode(text.slice(0, split.at)).length;
		if (rewritten.length > 0) controller.enqueue(rewritten);
		if (consumed < read.length) controller.enqueue(read.subarray(consumed));
		passing = true;
	};
	const sendWhenSplit = (
		controller: TransformStreamDefaultController<Uint8Array>,
		ended: boolean,
	) => {
		const text = utf8(read);
		const split = text === undefined ? asIs : documentSplit(text, ended);
		if (split !== undefined) send(controller, text ?? "", split);
	};
	return body.pipeThrough(
		new TransformStream({
			transform(chunk, controller) {
				if (passing) return controller.enqueue(chunk);
				read = concatenated(read, chunk);
				sendWhenSplit(controller, false);
			},
			flush(controller) {
				if (!passing && read.length > 0) sendWhenSplit(controller, true);
			},
		}),
	);
}

/**
 * Where a document's start ends, and what it becomes: every character of the text read so far
 * from `at` on passes through unchanged.
 */
type Split = { at: number; rewrite: (start: DocumentStart) => string };

/** The body as it is. */
const asIs: Split = { at: 0, rewrite: () => "" };

/** A start tag: where it starts and ends, and each attribute's lowercased name and source. */
type StartTag = {
	start: number;
	end: number;
	attributes: readonly { name: string; source: string }[];
};

const DOCTYPE = /^\s*<!doctype\s[^>]*>/i;

/**
 * Where the start of the document in `text` ends, or undefined while more of it is needed; `ended`
 * says the text is the whole body. HTML lets a document leave out its `<html>` and `<head>` start
 * tags, so the rewrite writes `<html>` when there is none, and opens the head right after it when
 * there is no `<head>`.
 */
function documentSplit(text: string, ended: boolean): Split | undefined {
	const doctype = DOCTYPE.exec(text);
	if (doctype === null) {
		const opening = text.trimStart().slice(0, "<!doctype".length).toLowerCase();
		return ended || !"<!doctype".startsWith(opening) ? asIs : undefined;
	}
	const afterDoctype = doctype[0].length;
	const html = elementStart(text, afterDoctype, "html");
	if (html === "cut") return ended ? asIs : undefined;
	const afterHtml = html?.end ?? afterDoctype;
	const head = elementStart(text, afterHtml, "head");
	if (head === "cut" && !ended) return undefined;
	const opened = typeof head === "object" ? head.end : afterHtml;
	return {
		at: opened,
		rewrite: (start) =>
			text.slice(0, html?.start ?? afterDoctype) +
			htmlStartTag(html?.attributes ?? [], start) +
			text.slice(afterHtml, opened) +
			start.head,
	};
}

/** `<html>` with the page's `lang` and `dir`, and every other attribute it was written with. */
function htmlStartTag(
	attributes: StartTag["attributes"],
	{ lang, dir }: DocumentStart,
): string {
	const kept = attributes
		.filter(({ name }) => name !== "lang" && name !== "dir")
		.map(({ source }) => ` ${source}`)
		.join("");
	return `<html${kept} lang="${lang}" dir="${dir}">`;
}

/**
 * The start tag of element `name` if it comes next after `from`, past spaces and comments;
 * undefined if something else comes next, and "cut" while the text ends too soon to tell.
 */
function elementStart(
	text: string,
	from: number,
	name: string,
): StartTag | undefined | "cut" {
	const at = afterSpacesAndComments(text, from);
	if (at === undefined) return "cut";
	const opening = `<${name}`;
	const next = text.slice(at, at + opening.length + 1).toLowerCase();
	if (next.length <= opening.length) {
		return opening.startsWith(next) ? "cut" : undefined;
	}
	if (!next.startsWith(opening) || !/[\s/>]/.test(next.charAt(opening.length)))
		return undefined;
	return startTag(text, at, at + opening.length) ?? "cut";
}

/**
 * Where the text goes on after spaces and whole comments, or undefined while it may be in a
 * comment: inside one, or at what may be its opening.
 */
function afterSpacesAndComments(
	text: string,
	from: number,
): number | undefined {
	let at = afterSpaces(text, from);
	while (text.startsWith("<!--", at)) {
		const close = text.indexOf("-->", at + "<!--".length);
		if (close === -1) return undefined;
		at = afterSpaces(text, close + "-->".length);
	}
	const rest = text.slice(at);
	return rest.length < "<!--".length && "<!--".startsWith(rest)
		? undefined
		: at;
}

const afterSpaces = (text: string, from: number): number =>
	from + (/^\s*/.exec(text.slice(from))?.[0].length ?? 0);

/**
 * The start tag at `start` whose name ends at `nameEnd`, as HTML tokenizes it: attributes with a
 * quoted, unquoted or no value, up to the `>` outside a quote. Undefined while the tag is cut off.
 */
function startTag(
	text: string,
	start: number,
	nameEnd: number,
): StartTag | undefined {
	const attributes: { name: string; source: string }[] = [];
	let at = nameEnd;
	while (at < text.length) {
		const char = text.charAt(at);
		if (char === ">") return { start, end: at + 1, attributes };
		if (char === "/" || /\s/.test(char)) {
			at++;
			continue;
		}
		const attribute = attributeAt(text, at);
		if (attribute === undefined) return undefined;
		attributes.push(attribute);
		at += attribute.source.length;
	}
	return undefined;
}

/** The attribute that starts at `from`, or undefined while it is cut off. */
function attributeAt(
	text: string,
	from: number,
): { name: string; source: string } | undefined {
	const rest = text.slice(from);
	// A name runs to a space, `/`, `>` or `=`, but may start with `=`, as HTML tokenizes it.
	const name = /^=?[^\s/>=]*/.exec(rest)?.[0] ?? "";
	if (name.length === rest.length) return undefined;
	const equals = /^\s*=\s*/.exec(rest.slice(name.length))?.[0];
	if (equals === undefined) {
		return { name: name.toLowerCase(), source: name };
	}
	const valueAt = name.length + equals.length;
	const quote = rest.charAt(valueAt);
	const valueEnd =
		quote === '"' || quote === "'"
			? rest.indexOf(quote, valueAt + 1) + 1
			: valueAt + (/^[^\s>]*/.exec(rest.slice(valueAt))?.[0].length ?? 0);
	if (valueEnd === 0 || valueEnd === rest.length) return undefined;
	return { name: name.toLowerCase(), source: rest.slice(0, valueEnd) };
}

/**
 * The bytes as text, a character cut off at the end left out, or undefined if they are not UTF-8.
 * The byte order mark is kept, so the text encodes back to the same bytes.
 */
function utf8(bytes: Uint8Array): string | undefined {
	try {
		return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
			bytes,
			{ stream: true },
		);
	} catch {
		return undefined;
	}
}

function concatenated(a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> {
	const joined = new Uint8Array(a.length + b.length);
	joined.set(a);
	joined.set(b, a.length);
	return joined;
}
