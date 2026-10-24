import { expect, it } from "vitest";
import { cardinalRules, ordinalRules } from "../src/plural-rules.ts";
import {
	categoriesOf,
	type PluralType,
	pluralModule,
	pluralName,
} from "../src/plurals.ts";

const others = [
	...[
		0.5, 1.5, 2.25, 11.1, 21.5, 101.01, 0.000001, 1e-7, 4.56789, 0.9999, 1.0005,
	],
	...[-1, -2, -5, -21, -1.5],
	1_000_000,
	2_000_000,
];

/**
 * Where plurals.js disagrees with Intl.PluralRules of a type, for every locale of CLDR's rules of
 * that type Intl knows: on a count's category, and on a locale's categories.
 */
async function disagreements(
	type: PluralType,
	languages: Readonly<Record<string, unknown>>,
	counts: readonly number[],
): Promise<{ locales: readonly string[]; differences: string[] }> {
	const locales = Intl.PluralRules.supportedLocalesOf(Object.keys(languages));
	const plurals = await import(
		`data:text/javascript;base64,${Buffer.from(pluralModule(locales)).toString("base64")}`
	);
	const differences: string[] = [];
	for (const locale of locales) {
		const rules = new Intl.PluralRules(locale, { type });
		const plural: (count: number) => string = plurals[pluralName(locale, type)];
		for (const count of counts) {
			if (plural(count) !== rules.select(count)) {
				differences.push(
					`${locale} ${count}: ${plural(count)}, Intl ${rules.select(count)}`,
				);
			}
		}
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

it("chooses every locale's category as Intl.PluralRules does, for whole counts and fractions", async () => {
	const { locales, differences } = await disagreements(
		"cardinal",
		cardinalRules,
		[...Array.from({ length: 10_001 }, (_, count) => count), ...others],
	);

	expect(locales.length).toBeGreaterThan(200);
	expect(differences).toEqual([]);
});

it("chooses every locale's ordinal category as Intl.PluralRules does with type ordinal", async () => {
	const { locales, differences } = await disagreements(
		"ordinal",
		ordinalRules,
		[...Array.from({ length: 1001 }, (_, count) => count), ...others],
	);

	expect(locales.length).toBeGreaterThan(100);
	expect(differences).toEqual([]);
});

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
