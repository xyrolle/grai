/**
 * Reading translation units back from XLIFF 2.0: the units of its files and groups, each unit's
 * segments and ignorables joined, its codes by id. A unit whose content grai does not read is
 * given back with the reason, for the merge to refuse it alone.
 */

import type { ReturnedPiece, ReturnedUnit } from "./returned-units.ts";
import { xliffNamespace } from "./xliff-writer.ts";
import { readXml, type XmlElement, type XmlNode } from "./xml-reader.ts";

/** A document's languages and units, as the merge reads them. */
export type ReadXliff = {
	srcLang: string;
	trgLang: string;
	units: ReturnedUnit[];
};

/**
 * Reads an XLIFF 2.0 document of units: those in its files and groups, each unit's segments and
 * ignorables joined, in order. Throws an XmlError, or an Error naming what grai does not read.
 */
export function readXliff(text: string): ReadXliff {
	const root = readXml(text);
	const version = root.attributes.get("version") ?? "";
	if (
		root.name !== "xliff" ||
		root.attributes.get("xmlns") !== xliffNamespace ||
		!version.startsWith("2.")
	) {
		throw new Error(
			`it is not an XLIFF 2 document: its root is <${root.name}>, version "${version}".`,
		);
	}
	const srcLang = root.attributes.get("srcLang");
	const trgLang = root.attributes.get("trgLang");
	if (srcLang === undefined || trgLang === undefined) {
		throw new Error("its <xliff> needs srcLang and trgLang.");
	}
	return { srcLang, trgLang, units: unitsIn(root) };
}

function elements(node: XmlElement, name?: string): XmlElement[] {
	return node.children.filter(
		(child): child is XmlElement =>
			typeof child !== "string" && (name === undefined || child.name === name),
	);
}

function unitsIn(node: XmlElement): ReturnedUnit[] {
	return elements(node).flatMap((child) =>
		child.name === "unit"
			? [readUnit(child)]
			: child.name === "file" || child.name === "group"
				? unitsIn(child)
				: [],
	);
}

function readUnit(unit: XmlElement): ReturnedUnit {
	const id = unit.attributes.get("id") ?? "";
	try {
		const source: ReturnedPiece[] = [];
		let target: ReturnedPiece[] | undefined = [];
		for (const part of elements(unit).filter(
			(child) => child.name === "segment" || child.name === "ignorable",
		)) {
			const [written] = elements(part, "source");
			const [translated] = elements(part, "target");
			const pieces = written === undefined ? [] : readInline(written.children);
			source.push(...pieces);
			if (translated !== undefined)
				target?.push(...readInline(translated.children));
			else if (part.name === "ignorable") target?.push(...pieces);
			else target = undefined;
		}
		return { id, source, target, problem: undefined };
	} catch (error) {
		if (!(error instanceof UnreadContent)) throw error;
		return { id, source: [], target: undefined, problem: error.message };
	}
}

/** Inline content grai does not read, in one unit. */
class UnreadContent extends Error {}

function readInline(nodes: readonly XmlNode[]): ReturnedPiece[] {
	const pieces: ReturnedPiece[] = [];
	for (const node of nodes) {
		if (typeof node === "string") {
			pieces.push({ text: node });
			continue;
		}
		const id = node.attributes.get("id") ?? "";
		switch (node.name) {
			case "ph":
				pieces.push({ code: { id, written: "ph" } });
				break;
			case "pc":
				pieces.push(
					{ code: { id, written: "start" } },
					...readInline(node.children),
					{
						code: { id, written: "end" },
					},
				);
				break;
			case "sc":
				pieces.push({ code: { id, written: "start" } });
				break;
			case "ec":
				pieces.push({
					code: { id: node.attributes.get("startRef") ?? id, written: "end" },
				});
				break;
			case "cp":
				pieces.push({ text: codePoint(node.attributes.get("hex") ?? "") });
				break;
			case "mrk":
				pieces.push(...readInline(node.children));
				break;
			case "sm":
			case "em":
				break;
			default:
				throw new UnreadContent(
					`it holds <${node.name}>, which grai does not read in a source or a target.`,
				);
		}
	}
	return mergedText(pieces);
}

/** The character a `<cp hex>` stands for. */
function codePoint(hex: string): string {
	const code = /^[0-9A-Fa-f]{1,6}$/.test(hex) ? Number.parseInt(hex, 16) : -1;
	if (code < 0 || code > 0x10ffff) {
		throw new UnreadContent(`its <cp hex="${hex}"> names no character.`);
	}
	return String.fromCodePoint(code);
}

/** Pieces with adjacent texts joined, so that a `<cp>` or a CDATA section reads as part of its text. */
function mergedText(pieces: readonly ReturnedPiece[]): ReturnedPiece[] {
	const merged: ReturnedPiece[] = [];
	for (const piece of pieces) {
		const last = merged.at(-1);
		if ("text" in piece && last !== undefined && "text" in last) {
			merged[merged.length - 1] = { text: last.text + piece.text };
		} else merged.push(piece);
	}
	return merged;
}
