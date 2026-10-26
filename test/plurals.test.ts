import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { cardinalRules, ordinalRules } from "../src/plural-rules.ts";
import {
	categoriesOf,
	type PluralType,
	pluralModule,
	pluralName,
} from "../src/plurals.ts";

/**
 * Whether the engine's CLDR is the release grai's rules are compiled from, the cldr-core this repo
 * pins. Intl.PluralRules is the reference only then: a locale's rules change between releases, as
 * Sicilian's ordinals did in CLDR 48, and an older engine keeps the old ones.
 */
const cldrCore: { version: string } = JSON.parse(
	readFileSync(
		new URL("../node_modules/cldr-core/package.json", import.meta.url),
		"utf8",
	),
);
const sameCldr =
	process.versions.cldr?.split(".")[0] === cldrCore.version.split(".")[0];

const others = [
	...[
		0.5, 1.5, 2.25, 11.1, 21.5, 101.01, 0.000001, 1e-7, 4.56789, 0.9999, 1.0005,
	],
	...[-1, -2, -5, -21, -1.5],
	1_000_000,
	2_000_000,
	...[Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
];

/** plurals.js for these locales, loaded, with the digits a rounding selector shows or without. */
async function plurals(
	locales: readonly string[],
	digits: boolean,
): Promise<Record<string, (count: number | string) => string>> {
	const code = pluralModule(locales, { digits });
	return await import(
		`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
	);
}

/**
 * Where plurals.js disagrees with Intl.PluralRules of a type, for every locale of CLDR's rules of
 * that type Intl knows, with and without the digits a rounding selector shows: on a count's
 * category, and on a locale's categories.
 */
async function disagreements(
	type: PluralType,
	languages: Readonly<Record<string, unknown>>,
	counts: readonly number[],
): Promise<{ locales: readonly string[]; differences: string[] }> {
	const locales = Intl.PluralRules.supportedLocalesOf(Object.keys(languages));
	const differences: string[] = [];
	for (const digits of [false, true]) {
		const functions = await plurals(locales, digits);
		for (const locale of locales) {
			const rules = new Intl.PluralRules(locale, { type });
			const plural = functions[pluralName(locale, type)];
			for (const count of counts) {
				if (plural?.(count) !== rules.select(count)) {
					differences.push(
						`${digits ? "digits " : ""}${locale} ${count}: ${plural?.(count)}, Intl ${rules.select(count)}`,
					);
				}
			}
		}
	}
	for (const locale of locales) {
		const rules = new Intl.PluralRules(locale, { type });
		const intl = new Set<string>(rules.resolvedOptions().pluralCategories);
		const categories = categoriesOf(locale, type).join(", ");
		const expected = ["zero", "one", "two", "few", "many", "other"]
			.filter((category) => intl.has(category))
			.join(", ");
		if (categories !== expected) {
			differences.push(`${locale}: ${categories}, Intl ${expected}`);
		}
	}
	return { locales, differences };
}

it.runIf(sameCldr)(
	"chooses every locale's category as Intl.PluralRules does, for whole counts and fractions",
	async () => {
		const { locales, differences } = await disagreements(
			"cardinal",
			cardinalRules,
			[...Array.from({ length: 10_001 }, (_, count) => count), ...others],
		);

		expect(locales.length).toBeGreaterThan(200);
		expect(differences).toEqual([]);
	},
);

it.runIf(sameCldr)(
	"chooses every locale's ordinal category as Intl.PluralRules does with type ordinal",
	async () => {
		const { locales, differences } = await disagreements(
			"ordinal",
			ordinalRules,
			[...Array.from({ length: 1001 }, (_, count) => count), ...others],
		);

		expect(locales.length).toBeGreaterThan(100);
		expect(differences).toEqual([]);
	},
);

it("gives a regional locale its language's rules, and one CLDR does not know only other", () => {
	expect(categoriesOf("en-GB", "cardinal")).toEqual(["one", "other"]);
	expect(categoriesOf("en-GB", "ordinal")).toEqual([
		"one",
		"two",
		"few",
		"other",
	]);
	expect(categoriesOf("pt-PT", "cardinal")).toEqual(["one", "many", "other"]);
	expect(categoriesOf("tlh", "cardinal")).toEqual(["other"]);
	expect(categoriesOf("tlh", "ordinal")).toEqual(["other"]);
});

it("reads the whole percent Intl.NumberFormat shows a count as", async () => {
	const { percent } = await import(
		`data:text/javascript;base64,${Buffer.from(pluralModule(["en"])).toString("base64")}`
	);
	const shown = new Intl.NumberFormat("en", {
		style: "percent",
		useGrouping: false,
	});
	const counts = Array.from(
		{ length: 40_001 },
		(_, step) => (step - 20_000) / 10_000,
	);

	expect(
		counts.filter(
			(count) => percent(count) !== Number(shown.format(count).slice(0, -1)),
		),
	).toEqual([]);
});

/** Options that round a number, each set as a :number local writes them. */
const roundings: readonly Intl.NumberFormatOptions[] = [
	{ minimumFractionDigits: 1 },
	{ minimumFractionDigits: 2, maximumFractionDigits: 2 },
	{ maximumFractionDigits: 0 },
	{ maximumFractionDigits: 1, roundingMode: "floor" },
	{ minimumSignificantDigits: 3 },
	{ maximumSignificantDigits: 2 },
	{
		maximumSignificantDigits: 2,
		maximumFractionDigits: 1,
		roundingPriority: "lessPrecision",
	},
	{ minimumFractionDigits: 2, maximumFractionDigits: 2, roundingIncrement: 5 },
	{ minimumFractionDigits: 2, trailingZeroDisplay: "stripIfInteger" },
];
const rounded = [
	...[0, 1, 2, 3, 5, 7, 11, 21, 101, 1000, 1_000_000],
	...[
		0.5, 0.95, 1.04, 1.05, 1.5, 2.25, 11.1, 21.5, 101.01, 0.001, 1.2345, 7.999,
	],
	...[-1, -1.5],
	...[Number.NaN, Number.POSITIVE_INFINITY],
];

it("chooses every locale's category of the digits a rounding :number shows, as Intl.PluralRules does with its options", async () => {
	for (const [type, languages] of [
		["cardinal", cardinalRules],
		["ordinal", ordinalRules],
	] as const) {
		const locales = Intl.PluralRules.supportedLocalesOf(Object.keys(languages));
		const functions = await plurals(locales, true);
		const differences: string[] = [];
		for (const options of roundings) {
			const shown = new Intl.NumberFormat("en", {
				...options,
				useGrouping: false,
			});
			for (const locale of locales) {
				const rules = new Intl.PluralRules(locale, { ...options, type });
				const plural = functions[pluralName(locale, type)];
				for (const count of rounded) {
					const digits = shown.format(count);
					if (plural?.(digits) !== rules.select(count)) {
						differences.push(
							`${type} ${locale} ${JSON.stringify(options)} ${count} as ${digits}: ${plural?.(digits)}, Intl ${rules.select(count)}`,
						);
					}
				}
			}
		}

		expect(locales.length).toBeGreaterThan(100);
		expect(differences.slice(0, 20)).toEqual([]);
	}
});
