// Text written into a Svelte template so that Svelte reads back exactly that text. Svelte trims
// the whitespace at the edges of an element's static text, and does so with an entity too, but
// only in its server output (`&#32;` stays in the client template), so edge whitespace goes in as
// an expression, which Svelte keeps on both sides.

/** Escapes text for a template, where `{` opens an expression and `<` and `&` are markup. */
export const escapeText = (text) =>
	text
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/\{/g, "&#123;")
		.replace(/\}/g, "&#125;");

/** Escapes text for a quoted attribute value, whichever quote it is in. */
export const escapeAttribute = (text) =>
	escapeText(text).replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Whitespace as an expression, which Svelte keeps where it trims static text. */
export const keptSpaces = (spaces) =>
	spaces === "" ? "" : `{${JSON.stringify(spaces)}}`;

const edges = /^([ \t\r\n]*)([\s\S]*?)([ \t\r\n]*)$/;

/** A text's leading whitespace, as Svelte trims it, what it holds, and its trailing whitespace. */
export function splitEdges(text) {
	const [, leading, body, trailing] = edges.exec(text);
	return { leading, body, trailing };
}

/** A text as template text, its edge whitespace kept. */
export function templateText(text) {
	const { leading, body, trailing } = splitEdges(text);
	return `${keptSpaces(leading)}${escapeText(body)}${keptSpaces(trailing)}`;
}
