import { expect, it } from "vitest";
import { pluralRules } from "../src/plural-rules.ts";
import { categoriesOf, pluralModule, pluralName } from "../src/plurals.ts";

const counts = [
	...Array.from({ length: 10_001 }, (_, count) => count),
	...[
		0.5, 1.5, 2.25, 11.1, 21.5, 101.01, 0.000001, 1e-7, 4.56789, 0.9999, 1.0005,
	],
	...[-1, -2, -5, -21, -1.5],
	1_000_000,
	2_000_000,
];

it("chooses every locale's category as Intl.PluralRules does, for whole counts and fractions", async () => {
	const locales = Intl.PluralRules.supportedLocalesOf(Object.keys(pluralRules));
	const plurals = await import(
		`data:text/javascript;base64,${Buffer.from(pluralModule(locales)).toString("base64")}`
	);
	const disagreements: string[] = [];
	for (const locale of locales) {
		const rules = new Intl.PluralRules(locale);
		const plural: (count: number) => string = plurals[pluralName(locale)];
		for (const count of counts) {
			if (plural(count) !== rules.select(count)) {
				disagreements.push(
					`${locale} ${count}: ${plural(count)}, Intl ${rules.select(count)}`,
				);
			}
		}
		expect(categoriesOf(locale)).toEqual(
			["zero", "one", "two", "few", "many", "other"].filter((category) =>
				new Set<string>(rules.resolvedOptions().pluralCategories).has(category),
			),
		);
	}

	expect(locales.length).toBeGreaterThan(200);
	expect(disagreements).toEqual([]);
});

it("gives a regional locale its language's rules, and one CLDR does not know only other", () => {
	expect(categoriesOf("en-GB")).toEqual(["one", "other"]);
	expect(categoriesOf("pt-PT")).toEqual(["one", "many", "other"]);
	expect(categoriesOf("tlh")).toEqual(["other"]);
});
