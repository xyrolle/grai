/** Text as XML holds it: escaped for content and for attributes, as an id, and the characters it can hold at all. */

/** Whether a code point can be written in XML 1.0, as itself or as a character reference. */
export function isXmlCharacter(code: number): boolean {
	return (
		code === 0x9 ||
		code === 0xa ||
		code === 0xd ||
		(code >= 0x20 && code <= 0xd7ff) ||
		(code >= 0xe000 && code <= 0xfffd) ||
		(code >= 0x10000 && code <= 0x10ffff)
	);
}

/** Text as element content: `&` and `<` escaped, `>` too so that `]]>` cannot appear, and `\r` kept. */
export function escapeText(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("\r", "&#13;");
}

/** Text as a double-quoted attribute value, its whitespace kept through attribute normalization. */
export function escapeAttribute(text: string): string {
	return escapeText(text)
		.replaceAll('"', "&quot;")
		.replaceAll("\t", "&#9;")
		.replaceAll("\n", "&#10;");
}

/**
 * Text as an id, which XML holds as a name token: letters, digits and _ as they are, any other
 * character as -hex-. Neither `.` nor a lone `-` is then part of the text, so either can join it.
 */
export function idText(text: string): string {
	return text.replaceAll(
		/[^A-Za-z0-9_]/gu,
		(character) => `-${(character.codePointAt(0) ?? 0).toString(16)}-`,
	);
}
