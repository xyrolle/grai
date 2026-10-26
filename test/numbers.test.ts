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

	it("selects on a :percent by the percent it shows, exactly, then by its plural category", async () => {
		const { m } = await project({
			en: {
				done: onNumber("percent", {
					"n=100": "all done",
					"n=29": "twenty-nine",
					"n=one": "{n} done, one",
					"n=*": "{n} done",
				}),
			},
		}).load();

		expect(
			[1, 0.29, 0.01, 0.5, 0.014, 0.995].map((count) => m.done?.({ count })),
		).toEqual([
			"all done",
			"twenty-nine",
			"1% done, one",
			"50% done",
			"1% done, one",
			"all done",
		]);
	});

	it("selects on a :number whose options round it by the digits it shows: exactly, then by their category, as Intl.PluralRules does with those options", async () => {
		const shown = (categories: string[]) =>
			onNumber("number minimumFractionDigits=1", {
				"n=1.0": "exact",
				...Object.fromEntries(
					categories.map((category) => [`n=${category}`, category]),
				),
				"n=*": "other",
			});
		const { m } = await project({
			en: { shown: shown(["one"]) },
			ru: { shown: shown(["one", "few", "many"]) },
		}).load();
		const digits = new Intl.NumberFormat("en", { minimumFractionDigits: 1 });

		for (const locale of ["en", "ru"]) {
			const rules = new Intl.PluralRules(locale, { minimumFractionDigits: 1 });
			for (const count of [0, 1, 2, 5, 21, 1.5, 0.999, 1.0004]) {
				expect(m.shown?.({ count }, { locale })).toBe(
					digits.format(count) === "1.0" ? "exact" : rules.select(count),
				);
			}
		}
	});

	it("rounds as each function's options round: :number, :integer and :percent", async () => {
		const { m } = await project({
			en: {
				rounded: onNumber("number maximumFractionDigits=0", {
					"n=1": "exactly one",
					"n=one": "one",
					"n=*": "{n}",
				}),
				whole: onNumber("integer maximumSignificantDigits=1", {
					"n=20": "twenty",
					"n=*": "{n}",
				}),
				share: onNumber("percent maximumFractionDigits=1", {
					"n=1.5": "one and a half",
					"n=one": "one",
					"n=*": "{n}",
				}),
			},
		}).load();

		expect([1.4, 0.6, 1.5, 2].map((count) => m.rounded?.({ count }))).toEqual([
			"exactly one",
			"exactly one",
			"2",
			"2",
		]);
		expect([15, 24, 25].map((count) => m.whole?.({ count }))).toEqual([
			"twenty",
			"twenty",
			"30",
		]);
		expect(
			[0.015, 0.01, 0.0104, 0.016].map((count) => m.share?.({ count })),
		).toEqual(["one and a half", "one", "one", "1.6%"]);
	});

	it("is an error for a key the options never show", async () => {
		expect(
			await errorsOf({
				en: {
					padded: onNumber("number minimumFractionDigits=1", {
						"n=1": "a",
						"n=*": "b",
					}),
					rounded: onNumber("number maximumFractionDigits=1", {
						"n=1.25": "a",
						"n=*": "b",
					}),
				},
			}),
		).toEqual([
			'message-invalid: messages/en.json: "padded" (en): the variant n=1 can never be chosen: n shows 1 as 1.0, and no value as 1. Write the key as n shows it.',
			'message-invalid: messages/en.json: "rounded" (en): the variant n=1.25 can never be chosen: n shows 1.25 as 1.3, and no value as 1.25. Write the key as n shows it.',
		]);
	});

	it("moves a value by :offset's subtract or add, then chooses and formats it as :number does", async () => {
		const { m } = await project({
			en: {
				likes: [
					{
						declarations: [
							"input count",
							"local others = count: offset subtract=1",
						],
						selectors: ["count", "others"],
						match: {
							"count=0,others=*": "No likes",
							"count=1,others=*": "You like it",
							"count=*,others=one": "You and {others} other",
							"count=*,others=*": "You and {others} others",
						},
					},
				],
				place: onNumber("offset add=1", { "n=1": "first", "n=*": "{n}th" }),
				left: "{|5| :offset subtract=1} left",
			},
		}).load();

		expect([0, 1, 2, 3, 1001].map((count) => m.likes?.({ count }))).toEqual([
			"No likes",
			"You like it",
			"You and 1 other",
			"You and 2 others",
			"You and 1,000 others",
		]);
		expect([0, 4].map((count) => m.place?.({ count }))).toEqual([
			"first",
			"5th",
		]);
		expect(m.left?.()).toBe("4 left");
	});

	it("is an error for a key no value can match, or for a value no variant has", async () => {
		expect(
			await errorsOf({
				en: {
					written: onNumber("number", { "n=1.0": "a", "n=*": "b" }),
					fraction: onNumber("integer", { "n=1.5": "a", "n=*": "b" }),
					percent_fraction: onNumber("percent", { "n=1.5": "a", "n=*": "b" }),
					exact: onNumber("number select=exact", { "n=one": "a", "n=*": "b" }),
					category: onNumber("number", { "n=few": "a", "n=*": "b" }),
					uncovered: onNumber("number", { "n=0": "a", "n=one": "b" }),
					open: onNumber("number select=exact", { "n=0": "a" }),
					mode: onNumber("number select=cardinal", { "n=*": "a" }),
					percent_mode: onNumber("percent select=ordinal", { "n=*": "a" }),
					price: onNumber("currency currency=EUR", { "n=*": "a" }),
					still: onNumber("offset", { "n=*": "a" }),
					both: onNumber("offset add=1 subtract=1", { "n=*": "a" }),
					negative: onNumber("offset subtract=-1", { "n=*": "a" }),
					huge: onNumber(`offset add=${"9".repeat(17)}`, { "n=*": "a" }),
				},
			}),
		).toEqual([
			'message-invalid: messages/en.json: "both" (en): "local n = count: offset add=1 subtract=1": :offset takes add or subtract, not both.',
			'plural-category-unknown: messages/en.json: "category" (en): "few" is not a number or a plural category of en, so the variant n=few can never be chosen. Its categories are one, other.',
			'message-invalid: messages/en.json: "exact" (en): the variant n=one can never be chosen: n selects by its exact value (select=exact), so a key is a number or *.',
			'message-invalid: messages/en.json: "fraction" (en): the variant n=1.5 can never be chosen: n is a whole number. Remove it.',
			`message-invalid: messages/en.json: "huge" (en): "local n = count: offset add=${"9".repeat(17)}": "add=${"9".repeat(17)}" needs a whole number up to 9007199254740991, which a number holds exactly.`,
			'message-invalid: messages/en.json: "mode" (en): "local n = count: number select=cardinal": "select=cardinal" needs plural, ordinal or exact.',
			'message-invalid: messages/en.json: "negative" (en): "local n = count: offset subtract=-1": "subtract=-1" needs a whole number.',
			'selection-not-exhaustive: messages/en.json: "open" (en): no variant matches n=(any other value). Add one, or a variant with * for the selectors it does not care about.',
			'message-invalid: messages/en.json: "percent_fraction" (en): the variant n=1.5 can never be chosen: n is a whole number. Remove it.',
			'message-invalid: messages/en.json: "percent_mode" (en): "local n = count: percent select=ordinal": "select=ordinal" is not an option of :percent, or is given twice. Its options are signDisplay, useGrouping, minimumFractionDigits, maximumFractionDigits, minimumSignificantDigits, maximumSignificantDigits, roundingPriority, roundingMode, trailingZeroDisplay.',
			'unsupported: messages/en.json: "price" (en): it selects on n, a :currency value, which MessageFormat 2 does not select on. Select on the input, or on a :number local of it.',
			'message-invalid: messages/en.json: "still" (en): "local n = count: offset": :offset needs add or subtract, the whole number it moves the value by, such as subtract=1.',
			'selection-not-exhaustive: messages/en.json: "uncovered" (en): no variant matches n=other. Add one, or a variant with * for the selectors it does not care about.',
			'message-invalid: messages/en.json: "written" (en): the variant n=1.0 can never be chosen: a number matches the key it is written as, 1. Write that instead.',
		]);
	});
});
