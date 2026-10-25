import { describe, expect, it } from "vitest";
import { type Catalog, parseCatalog } from "../src/catalog.ts";
import { type Piece, piecesPattern } from "../src/pattern-pieces.ts";
import type { ReturnedUnit } from "../src/returned-units.ts";
import { isSeed } from "../src/seed.ts";
import { readUnitsJson, writeUnitsJson } from "../src/translation-json.ts";
import { mergeUnits } from "../src/translation-merge.ts";
import { exportUnits, type Unit } from "../src/translation-units.ts";
import { readXliff } from "../src/xliff-reader.ts";
import { writeXliff } from "../src/xliff-writer.ts";

/** A seeded pseudo-random generator (mulberry32), so that a failure runs again the same. */
function generator(seed: number): () => number {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Text that XML and the pattern syntax both make hard: markup, references, braces, controls. */
const characters = [
	"a",
	"B",
	" ",
	"&",
	"<",
	">",
	'"',
	"'",
	"{",
	"}",
	"\\",
	"é",
	"漢",
	"🎉",
	"ש",
	"\u0007",
	"\r",
	"\t",
	"\n",
	"]]>",
	"&amp;",
	" ",
];
const codes = [
	"{name}",
	"{n}",
	"{n :number}",
	"{when :date dateStyle=long}",
	"{#br/}",
	"{#a title=|{x}| href=|a\\|b}|/}",
];
/** Tags around words: a pair, two pairs that cross, and a tag never closed or never opened. "" is words. */
const tagShapes = [
	["{#b}", "", "{/b}"],
	["{#b}", "", "{#i}", "", "{/b}", "", "{/i}"],
	["{#i}", ""],
	["", "{/i}"],
];

function pieces(next: () => number): Piece[] {
	const result: Piece[] = [];
	const text = () =>
		Array.from(
			{ length: 1 + Math.floor(next() * 4) },
			() => characters[Math.floor(next() * characters.length)],
		).join("");
	for (let index = 0; index < 1 + Math.floor(next() * 5); index++) {
		const roll = next();
		if (roll < 0.5) result.push({ text: text() });
		else if (roll < 0.8) {
			result.push({
				id: "",
				kind: "placeholder",
				source: codes[Math.floor(next() * codes.length)] ?? "{name}",
			});
		} else {
			const shape = tagShapes[Math.floor(next() * tagShapes.length)] ?? [];
			for (const code of shape) {
				result.push(code === "" ? { text: text() } : tag(code));
			}
		}
	}
	return result;
}

function tag(source: string): Piece {
	return { id: "", kind: source.startsWith("{/") ? "close" : "open", source };
}

/** Every code of the base, so that a translation reads the same inputs, and new words around them. */
function translation(source: readonly Piece[], next: () => number): Piece[] {
	return source.map((piece) =>
		"text" in piece
			? { text: [...piece.text].reverse().join("") + (next() < 0.3 ? "ü" : "") }
			: piece,
	);
}

function catalog(locale: string, messages: Record<string, unknown>): Catalog {
	return parseCatalog({
		locale,
		file: `${locale}.json`,
		bytes: Buffer.from(JSON.stringify(messages)),
		fallsBack: false,
	});
}

function project(seed: number): { base: Catalog; target: Catalog } {
	const next = generator(seed);
	const english: Record<string, unknown> = {};
	const german: Record<string, unknown> = {};
	for (let index = 0; index < 6; index++) {
		const key = `key_${index}`;
		const shape = next();
		if (shape < 0.6) {
			const source = pieces(next);
			english[key] = piecesPattern(source);
			german[key] = piecesPattern(translation(source, next));
			continue;
		}
		if (shape < 0.65) {
			// German agrees with a gender English does not tell apart.
			const source = pieces(next);
			english[key] = piecesPattern(source);
			german[key] = [
				{
					declarations: ["input g"],
					selectors: ["g"],
					match: {
						"g=f": piecesPattern(translation(source, next)),
						"g=*": piecesPattern(translation(source, next)),
					},
				},
			];
			continue;
		}
		if (shape < 0.7) {
			const source = pieces(next);
			const declared = (pattern: readonly Piece[]) => [
				{
					declarations: ["input n", "local total = n: number"],
					selectors: [],
					match: { "": piecesPattern(pattern) },
				},
			];
			english[key] = declared(source);
			german[key] = declared(translation(source, next));
			continue;
		}
		const one = pieces(next);
		const other = pieces(next);
		const plural = (a: readonly Piece[], b: readonly Piece[]) => [
			{
				declarations: ["input n", "local nPlural = n: plural"],
				selectors: ["nPlural"],
				match: {
					"nPlural=one": piecesPattern(a),
					"nPlural=*": piecesPattern(b),
				},
			},
		];
		english[key] = plural(one, other);
		german[key] = plural(translation(one, next), translation(other, next));
	}
	return { base: catalog("en", english), target: catalog("de", german) };
}

const targets = (units: readonly Unit[]) =>
	units.map((unit) => [
		unit.id,
		unit.target === undefined ? undefined : piecesPattern(unit.target),
	]);

/** The units a merge of these returned units gives back, exported again. */
function roundTrip(
	base: Catalog,
	target: Catalog,
	returned: readonly ReturnedUnit[],
): Unit[] {
	const merged = mergeUnits(base, target, "de", new Set(), returned);
	expect(merged.refused).toEqual([]);
	const messages = Object.fromEntries(target.messages);
	for (const [key, value] of merged.messages) messages[key] = value;
	return exportUnits(base, catalog("de", messages), "de", new Set());
}

describe("translation files, fuzzed", () => {
	it("give back every translation as it was, through XLIFF and through JSON", () => {
		for (let seed = 1; seed <= 150; seed++) {
			const { base, target } = project(seed);
			const units = exportUnits(base, target, "de", new Set());
			const xliff = readXliff(writeXliff("en", "de", units)).units;
			const json = readUnitsJson(writeUnitsJson("en", "de", units)).units;
			const translated = units.filter(
				({ key }) =>
					!isSeed(target.messages.get(key), base.messages.get(key), "de"),
			);

			expect(
				translated.filter((unit) => unit.target === undefined),
				`seed ${seed}`,
			).toEqual([]);
			expect(targets(roundTrip(base, target, xliff)), `seed ${seed}`).toEqual(
				targets(units),
			);
			expect(targets(roundTrip(base, target, json)), `seed ${seed}`).toEqual(
				targets(units),
			);
		}
	});

	it("read a damaged XLIFF file into an error or into units the merge refuses or takes, never a crash", () => {
		for (let seed = 1; seed <= 40; seed++) {
			const { base, target } = project(seed);
			const document = writeXliff(
				"en",
				"de",
				exportUnits(base, target, "de", new Set()),
			);
			const next = generator(seed * 7919);
			for (let mutation = 0; mutation < 50; mutation++) {
				const at = Math.floor(next() * document.length);
				const damaged =
					[
						document.slice(0, at),
						document.slice(0, at) +
							document.slice(at + 1 + Math.floor(next() * 8)),
						document.slice(0, at) +
							["<", "&", '"', ">", "</", "<x>", "&#0;", "]]>"][
								Math.floor(next() * 8)
							] +
							document.slice(at),
					][Math.floor(next() * 3)] ?? document;
				let units: ReturnedUnit[] | undefined;
				try {
					units = readXliff(damaged).units;
				} catch (error) {
					expect(
						error instanceof TypeError || error instanceof RangeError,
						String(error),
					).toBe(false);
					expect(error).toBeInstanceOf(Error);
				}
				if (units !== undefined)
					mergeUnits(base, target, "de", new Set(), units);
			}
		}
	});
});
