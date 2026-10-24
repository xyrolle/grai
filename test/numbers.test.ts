import { describe, expect, it } from "vitest";
import { errorsOf, project } from "./project.ts";

/** A message that selects on `local n = count: <call>`. */
const onNumber = (call: string, match: Record<string, string>) => [
	{
		declarations: ["input count", `local n = count: ${call}`],
		selectors: ["n"],
		match,
	},
];

describe("selecting on a :number local", () => {
	it("chooses an exact number, then the count's plural category, then *", async () => {
		const { m } = await project({
			en: {
				items: onNumber("number", {
					"n=*": "{n} items",
					"n=one": "{n} item",
					"n=0": "none",
					"n=1": "just one",
				}),
			},
			ru: {
				items: onNumber("number", {
					"n=*": "{n} штуки",
					"n=many": "{n} штук",
					"n=few": "{n} штуки",
					"n=one": "{n} штука",
					"n=0": "ничего",
					"n=1": "одна",
				}),
			},
		}).load();
		const counts = [0, 1, 2, 21, 1.5, 1000];

		expect(counts.map((count) => m.items?.({ count }))).toEqual([
			"none",
			"just one",
			"2 items",
			"21 items",
			"1.5 items",
			"1,000 items",
		]);
		expect(
			counts.map((count) => m.items?.({ count }, { locale: "ru" })),
		).toEqual([
			"ничего",
			"одна",
			"2 штуки",
			"21 штука",
			"1,5 штуки",
			`${new Intl.NumberFormat("ru").format(1000)} штук`,
		]);
	});

	it("chooses by ordinal categories with select=ordinal, and by the value alone with select=exact", async () => {
		const { m } = await project({
			en: {
				place: onNumber("number select=ordinal", {
					"n=1": "first",
					"n=one": "{n}st",
					"n=two": "{n}nd",
					"n=few": "{n}rd",
					"n=*": "{n}th",
				}),
				floor: onNumber("number select=exact", {
					"n=0": "ground",
					"n=-1": "basement",
					"n=*": "floor {n}",
				}),
			},
		}).load();

		expect([1, 2, 3, 11, 21, 102].map((count) => m.place?.({ count }))).toEqual(
			["first", "2nd", "3rd", "11th", "21st", "102nd"],
		);
		expect([0, -1, 1, 2].map((count) => m.floor?.({ count }))).toEqual([
			"ground",
			"basement",
			"floor 1",
			"floor 2",
		]);
	});

	it("takes a listed number's category variant where no variant lists it, as MessageFormat 2 does", async () => {
		const { m } = await project({
			en: {
				cats: [
					{
						declarations: ["input count", "input g", "local n = count: number"],
						selectors: ["n", "g"],
						match: {
							"n=1,g=male": "his one cat",
							"n=one,g=*": "their one cat",
							"n=*,g=*": "{n} cats",
						},
					},
				],
			},
		}).load();

		expect(m.cats?.({ count: 1, g: "male" })).toBe("his one cat");
		expect(m.cats?.({ count: 1, g: "female" })).toBe("their one cat");
		expect(m.cats?.({ count: 2, g: "male" })).toBe("2 cats");
	});

	it("rounds an :integer as it shows it, half away from zero, before choosing", async () => {
		const { m } = await project({
			en: {
				stars: onNumber("integer", {
					"n=3": "three: {n}",
					"n=one": "one: {n}",
					"n=*": "other: {n}",
				}),
			},
		}).load();

		expect(
			[2.5, 1.4, 0.6, -2.5, "3"].map((count) => m.stars?.({ count })),
		).toEqual(["three: 3", "one: 1", "one: 1", "other: -3", "three: 3"]);
	});

	it("is an error for a key no value can match, or for a value no variant has", async () => {
		expect(
			await errorsOf({
				en: {
					written: onNumber("number", { "n=1.0": "a", "n=*": "b" }),
					fraction: onNumber("integer", { "n=1.5": "a", "n=*": "b" }),
					exact: onNumber("number select=exact", { "n=one": "a", "n=*": "b" }),
					category: onNumber("number", { "n=few": "a", "n=*": "b" }),
					uncovered: onNumber("number", { "n=0": "a", "n=one": "b" }),
					open: onNumber("number select=exact", { "n=0": "a" }),
					mode: onNumber("number select=cardinal", { "n=*": "a" }),
				},
			}),
		).toEqual([
			'plural-category-unknown: messages/en.json: "category" (en): "few" is not a number or a plural category of en, so the variant n=few can never be chosen. Its categories are one, other.',
			'message-invalid: messages/en.json: "exact" (en): the variant n=one can never be chosen: n selects by its exact value (select=exact), so a key is a number or *.',
			'message-invalid: messages/en.json: "fraction" (en): the variant n=1.5 can never be chosen: n is a whole number. Remove it.',
			'message-invalid: messages/en.json: "mode" (en): "local n = count: number select=cardinal": "select=cardinal" needs plural, ordinal or exact.',
			'selection-not-exhaustive: messages/en.json: "open" (en): no variant matches n=(any other value). Add one, or a variant with * for the selectors it does not care about.',
			'selection-not-exhaustive: messages/en.json: "uncovered" (en): no variant matches n=other. Add one, or a variant with * for the selectors it does not care about.',
			'message-invalid: messages/en.json: "written" (en): the variant n=1.0 can never be chosen: a number matches the key it is written as, 1. Write that instead.',
		]);
	});
});
