import { describe, expect, it } from "vitest";
import { project, thrown } from "./project.ts";

const plural = (name: string, input: string, match: Record<string, string>) => [
	{
		declarations: [`input ${input}`, `local ${name} = ${input}: plural`],
		selectors: [name],
		match,
	},
];

describe("a compiled message", () => {
	it("renders in the locale it is given, else the base locale", async () => {
		const { m } = await project({
			en: { cart_title: "Your cart" },
			de: { cart_title: "Ihr Warenkorb" },
		}).load();

		expect(m.cart_title?.()).toBe("Your cart");
		expect(m.cart_title?.({}, { locale: "de" })).toBe("Ihr Warenkorb");
	});

	it("throws a GraiError for a locale the project does not have", async () => {
		const { m } = await project({ en: { cart_title: "Your cart" } }).load();

		expect(thrown(() => m.cart_title?.({}, { locale: "fr" }))).toMatchObject({
			name: "GraiError",
			code: "locale-unknown",
			message: '"fr" is not one of the project\'s locales: en.',
		});
	});

	it("interpolates its inputs", async () => {
		const { m } = await project({
			en: { cart_greeting: "Hello {name}, {count} new" },
		}).load();

		expect(m.cart_greeting?.({ name: "Ana", count: 3 })).toBe(
			"Hello Ana, 3 new",
		);
	});

	it("reads \\{, \\} and \\\\ as the characters, and a brace never closed as text", async () => {
		const { m } = await project({
			en: {
				braces: "\\{name\\} is \\\\ and { stays",
				template: "`$\\{name\\}` names {name}",
			},
		}).load();

		expect(m.braces?.()).toBe("{name} is \\ and { stays");
		// "$" and "{" apart, or Biome takes the string for a template literal written by mistake.
		expect(m.template?.({ name: "Ana" })).toBe("`$" + "{name}` names Ana");
	});

	it("leaves markup out of its text and gives it as parts", async () => {
		const { m } = await project({
			en: { terms: "Agree to the {#link}terms{/link}, {name}{#mark/}" },
		}).load();

		expect(m.terms?.({ name: "Ana" })).toBe("Agree to the terms, Ana");
		expect(m.terms?.parts?.({ name: "Ana" })).toEqual([
			{ type: "text", value: "Agree to the " },
			{ type: "markup-start", name: "link", options: {}, attributes: {} },
			{ type: "text", value: "terms" },
			{ type: "markup-end", name: "link", options: {}, attributes: {} },
			{ type: "text", value: ", " },
			{ type: "text", value: "Ana" },
			{ type: "markup-standalone", name: "mark", options: {}, attributes: {} },
		]);
	});

	it("chooses a plural variant by each locale's CLDR category", async () => {
		const { m } = await project({
			en: {
				items: plural("countPlural", "count", {
					"countPlural=one": "{count} item",
					"countPlural=other": "{count} items",
				}),
			},
			pl: {
				items: plural("countPlural", "count", {
					"countPlural=one": "{count} produkt",
					"countPlural=few": "{count} produkty",
					"countPlural=many": "{count} produktów",
					"countPlural=other": "{count} produktu",
				}),
			},
		}).load();
		const render = (locale: string) =>
			[0, 1, 2, 5, 22, 1.5].map((count) => m.items?.({ count }, { locale }));

		expect(render("en")).toEqual([
			"0 items",
			"1 item",
			"2 items",
			"5 items",
			"22 items",
			"1.5 items",
		]);
		expect(render("pl")).toEqual([
			"0 produktów",
			"1 produkt",
			"2 produkty",
			"5 produktów",
			"22 produkty",
			"1.5 produktu",
		]);
	});

	it("chooses an ordinal variant by each locale's CLDR ordinal category", async () => {
		const ordinal = (match: Record<string, string>) => [
			{
				declarations: ["input n", "local nOrdinal = n: plural type=ordinal"],
				selectors: ["nOrdinal"],
				match,
			},
		];
		const { m } = await project({
			en: {
				place: ordinal({
					"nOrdinal=one": "{n}st",
					"nOrdinal=two": "{n}nd",
					"nOrdinal=few": "{n}rd",
					"nOrdinal=*": "{n}th",
				}),
			},
			sv: {
				place: ordinal({ "nOrdinal=one": "{n}:a", "nOrdinal=*": "{n}:e" }),
			},
		}).load();
		const render = (locale: string) =>
			[1, 2, 3, 4, 11, 12, 21, 22, 103].map((n) =>
				m.place?.({ n }, { locale }),
			);

		expect(render("en")).toEqual([
			"1st",
			"2nd",
			"3rd",
			"4th",
			"11th",
			"12th",
			"21st",
			"22nd",
			"103rd",
		]);
		expect(render("sv")).toEqual([
			"1:a",
			"2:a",
			"3:e",
			"4:e",
			"11:e",
			"12:e",
			"21:a",
			"22:a",
			"103:e",
		]);
	});

	it("matches every selector of a variant, preferring a literal key to *", async () => {
		const { m } = await project({
			en: {
				invite: [
					{
						declarations: [
							"input role",
							"input count",
							"local countPlural = count: plural",
						],
						selectors: ["role", "countPlural"],
						match: {
							"role=*,countPlural=one": "one guest",
							"role=*,countPlural=other": "{count} guests",
							"role=admin,countPlural=*": "admins",
							"role=admin,countPlural=one": "one admin",
						},
					},
				],
			},
		}).load();

		expect(m.invite?.({ role: "admin", count: 1 })).toBe("one admin");
		expect(m.invite?.({ role: "admin", count: 4 })).toBe("admins");
		expect(m.invite?.({ role: "guest", count: 1 })).toBe("one guest");
		expect(m.invite?.({ role: "guest", count: 4 })).toBe("4 guests");
	});

	it("matches an input by its text, so 1 and '1' choose the same variant", async () => {
		const { m } = await project({
			en: {
				status: [
					{
						declarations: ["input code"],
						selectors: ["code"],
						match: { "code=1": "first", "code=*": "another" },
					},
				],
			},
		}).load();

		expect([
			m.status?.({ code: 1 }),
			m.status?.({ code: "1" }),
			m.status?.({ code: 2 }),
		]).toEqual(["first", "first", "another"]);
	});

	it("throws a GraiError for a value a select without * does not list", async () => {
		const { m } = await project({
			en: {
				month: [
					{
						declarations: ["input month"],
						selectors: ["month"],
						match: { "month=1": "Jan", "month=2": "Feb" },
					},
				],
			},
		}).load();

		expect(m.month?.({ month: 2 })).toBe("Feb");
		expect(thrown(() => m.month?.({ month: 13 }))).toMatchObject({
			name: "GraiError",
			code: "value-unmatched",
			message:
				'"month" (en) has no variant for month=13. Pass one of the values its type lists.',
		});
	});

	it("takes a message without selectors from the variant with the empty key", async () => {
		const { m } = await project({
			en: {
				expires: [
					{
						declarations: ["input date"],
						selectors: [],
						match: { "": "Expires {date}" },
					},
				],
			},
		}).load();

		expect(m.expires?.({ date: "today" })).toBe("Expires today");
	});

	it("lets one locale select where another has a plain pattern", async () => {
		const { m } = await project({
			en: {
				items: plural("countPlural", "count", {
					"countPlural=one": "{count} item",
					"countPlural=other": "{count} items",
				}),
			},
			de: { items: "{count} Artikel" },
		}).load();

		expect(m.items?.({ count: 1 })).toBe("1 item");
		expect(m.items?.({ count: 1 }, { locale: "de" })).toBe("1 Artikel");
	});
});
