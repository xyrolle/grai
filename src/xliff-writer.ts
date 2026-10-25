/**
 * Writing translation units as XLIFF 2.0, the OASIS standard translation tools exchange. A
 * placeholder is a `<ph>`, a pair of tags a `<pc>` around its words, or an `<sc>` and an `<ec>`
 * where it crosses another, so a tool keeps a translator from breaking either. A unit has a note of
 * its key's description for translators, and a plural form's another of the counts it is for.
 */

import type { Descriptions } from "./descriptions.ts";
import type { Code, Piece } from "./pattern-pieces.ts";
import type { Unit } from "./translation-units.ts";
import { escapeAttribute, escapeText } from "./xml-text.ts";

export const xliffNamespace = "urn:oasis:names:tc:xliff:document:2.0";

/** A locale's units as an XLIFF 2.0 document, each with its key's description, if it has one. */
export function writeXliff(
	srcLang: string,
	trgLang: string,
	units: readonly Unit[],
	descriptions: Descriptions,
): string {
	const lines = [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<xliff xmlns="${xliffNamespace}" version="2.0" srcLang="${escapeAttribute(srcLang)}" trgLang="${escapeAttribute(trgLang)}">`,
		'\t<file id="messages" xml:space="preserve">',
	];
	for (const unit of units) {
		const name = [
			unit.key,
			...unit.variant.map(([selector, key]) => `${selector}=${key}`),
		].join(" ");
		lines.push(
			`\t\t<unit id="${escapeAttribute(unit.id)}" name="${escapeAttribute(name)}">`,
		);
		const notes = [
			["description", descriptions.get(unit.key)],
			["variant", unit.note],
		].flatMap(([category, note]) =>
			note === undefined
				? []
				: [`<note category="${category}">${escapeText(note)}</note>`],
		);
		if (notes.length > 0) lines.push(`\t\t\t<notes>${notes.join("")}</notes>`);
		const state = unit.target === undefined ? "initial" : "translated";
		lines.push(`\t\t\t<segment state="${state}">`);
		lines.push(`\t\t\t\t<source>${inline(unit.source)}</source>`);
		if (unit.target !== undefined) {
			lines.push(`\t\t\t\t<target>${inline(unit.target)}</target>`);
		}
		lines.push("\t\t\t</segment>", "\t\t</unit>");
	}
	lines.push("\t</file>", "</xliff>", "");
	return lines.join("\n");
}

/**
 * Pieces as XLIFF inline content: a tag pair that nests properly as a `<pc>`, one that crosses
 * another as an `<sc>` and an `<ec>`, every other code as a `<ph>`, and a character XML cannot
 * hold as a `<cp>`.
 */
function inline(pieces: readonly Piece[]): string {
	let content = "";
	for (let index = 0; index < pieces.length; index++) {
		const piece = pieces[index];
		if (piece === undefined) continue;
		if ("text" in piece) {
			content += textContent(piece.text);
			continue;
		}
		const end = piece.kind === "open" ? closingIndex(pieces, index) : -1;
		if (end === -1) {
			content += codeElement(piece, pieces);
			continue;
		}
		const close = pieces[end];
		const dispEnd = close !== undefined && "id" in close ? close.source : "";
		content += `<pc id="${escapeAttribute(piece.id)}" dispStart="${escapeAttribute(piece.source)}" dispEnd="${escapeAttribute(dispEnd)}">${inline(pieces.slice(index + 1, end))}</pc>`;
		index = end;
	}
	return content;
}

/** A code as an element of its own: a tag of a pair as an `<sc>` or its `<ec>`, any other as a `<ph>`. */
function codeElement(code: Code, pieces: readonly Piece[]): string {
	const id = escapeAttribute(code.id);
	const disp = escapeAttribute(code.source);
	const paired = pieces.some(
		(piece) =>
			"id" in piece && piece.id === code.id && piece.kind !== code.kind,
	);
	if (paired && code.kind === "open") return `<sc id="${id}" disp="${disp}"/>`;
	if (paired && code.kind === "close")
		return `<ec startRef="${id}" disp="${disp}"/>`;
	return `<ph id="${id}" disp="${disp}"/>`;
}

/** Where the tag opened at `index` closes, if what lies between nests properly; else -1. */
function closingIndex(pieces: readonly Piece[], index: number): number {
	const opened = pieces[index];
	if (opened === undefined || !("id" in opened)) return -1;
	const open: string[] = [];
	for (let at = index + 1; at < pieces.length; at++) {
		const piece = pieces[at];
		if (piece === undefined || !("id" in piece)) continue;
		if (piece.kind === "open") open.push(piece.id);
		else if (piece.kind === "close") {
			if (piece.id === opened.id && open.length === 0) return at;
			if (open.pop() !== piece.id) return -1;
		}
	}
	return -1;
}

/** Characters XML cannot hold, even as references, which XLIFF writes as `<cp>`. */
const unwritable = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;

function textContent(text: string): string {
	return escapeText(text).replaceAll(
		unwritable,
		(character) =>
			`<cp hex="${(character.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}"/>`,
	);
}
