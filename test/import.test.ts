import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, onTestFinished } from "vitest";
import { type ImportFormat, importCatalogs } from "../src/import.ts";
import { compile } from "../src/index.ts";
import type { Messages } from "./project.ts";

/**
 * Writes source catalogs by path under `source/` in a new project for `locales`, the first its
 * base, imports them, and returns the result with a way to compile and load the messages.
 */
function imported(
	format: ImportFormat,
	sources: Record<string, unknown>,
	locales = ["en", "ru"],
) {
	const dir = mkdtempSync(join(tmpdir(), "grai-import-"));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const config = join(dir, "grai.config.json");
	writeFileSync(
		config,
		JSON.stringify({
			locales,
			baseLocale: locales[0],
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
	);
	for (const [path, catalog] of Object.entries(sources)) {
		const file = join(dir, "source", path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify(catalog));
	}
	const result = importCatalogs(config, format, [join(dir, "source")]);
	return {
		dir,
		result,
		catalog: (locale: string): Record<string, unknown> =>
			JSON.parse(readFileSync(join(dir, "messages", `${locale}.json`), "utf8")),
		load: async (): Promise<Messages> => {
			const compiled = await compile(config);
			expect(compiled.errors.map((error) => error.message)).toEqual([]);
			return (await import(pathToFileURL(join(dir, "out", "messages.js")).href))
				.m;
		},
	};
}

const counts = (render: (count: number) => string | undefined) =>
	[0, 1, 2, 5, 21].map(render);

describe("grai import --from i18next", () => {
	it("flattens nested keys into identifiers and reads {{name}} as a placeholder", async () => {
		const { result, load } = imported("i18next", {
			"en.json": {
				cart: { greeting: "Hello {{name}}, {{- raw}}!" },
				"a-b": "x",
			},
			"ru.json": {
				cart: { greeting: "Привет, {{name}}, {{- raw}}!" },
				"a-b": "y",
			},
		});
		const m = await load();

		expect(result.written).toEqual(["messages/en.json", "messages/ru.json"]);
		expect(Object.keys(m)).toEqual(["a_b", "cart_greeting"]);
		expect(
			m.cart_greeting?.({ name: "Ana", raw: "<b>" }, { locale: "ru" }),
		).toBe("Привет, Ana, <b>!");
	});

	it("turns plural suffixes into one message that chooses on count, _zero as an exact 0", async () => {
		const m = await imported("i18next", {
			"en.json": {
				item_zero: "No items",
				item_one: "One item",
				item_other: "{{count}} items",
			},
			"ru.json": {
				item_one: "{{count}} товар",
				item_few: "{{count}} товара",
				item_many: "{{count}} товаров",
				item_other: "{{count}} товара",
			},
		}).load();

		expect(counts((count) => m.item?.({ count }))).toEqual([
			"No items",
			"One item",
			"2 items",
			"5 items",
			"21 items",
		]);
		expect(counts((count) => m.item?.({ count }, { locale: "ru" }))).toEqual([
			"0 товаров",
			"1 товар",
			"2 товара",
			"5 товаров",
			"21 товар",
		]);
	});

	it("inlines $t(key) of a text, and leaves out in every locale what grai cannot express", async () => {
		const { result, load } = imported("i18next", {
			"en.json": {
				title: "Cart",
				see: "See $t(title)",
				rank_ordinal_one: "{{count}}st",
				rank_ordinal_other: "{{count}}th",
				ago: "{{value, relativetime}}",
			},
			"ru.json": {
				title: "Корзина",
				see: "См. $t(title)",
				rank_ordinal_other: "{{count}}-й",
				ago: "{{value, relativetime}}",
			},
		});
		const m = await load();

		expect(m.see?.()).toBe("See Cart");
		expect(Object.keys(m)).toEqual(["see", "title"]);
		expect(result.leftOut).toEqual([
			{
				file: "source/en.json",
				key: "rank_ordinal",
				locales: ["en", "ru"],
				detail:
					"its _ordinal_ forms pick an ordinal plural, which grai does not support yet.",
			},
			{
				file: "source/en.json",
				key: "ago",
				locales: ["en", "ru"],
				detail:
					"{{value, relativetime}} formats the value as relativetime, which grai import does not convert. Write it as {name :number} or {name :datetime} with the options it needs.",
			},
		]);
	});

	it("formats {{value, number}} and {{value, datetime}} as i18next does, through Intl", async () => {
		const { load } = imported("i18next", {
			"en.json": { price: "{{value, number}}", day: "On {{value, datetime}}" },
			"ru.json": { price: "{{value, number}}", day: "{{value, datetime}}" },
		});
		const m = await load();
		const when = new Date(Date.UTC(2026, 9, 24, 15, 5));

		expect(m.price?.({ value: 1234.5 }, { locale: "ru" })).toBe(
			new Intl.NumberFormat("ru").format(1234.5),
		);
		expect(m.day?.({ value: when })).toBe(
			`On ${new Intl.DateTimeFormat("en").format(when)}`,
		);
	});

	it("reports a plural form a locale lacks and a key that may be a context, which it imports as they are", () => {
		const { result } = imported("i18next", {
			"en.json": {
				item_one: "One",
				item_other: "Many",
				friend: "Friend",
				friend_male: "Boyfriend",
			},
			"ru.json": {
				item_one: "Один",
				item_other: "Много",
				friend: "Друг",
				friend_male: "Парень",
			},
		});

		expect(
			result.changed.map(
				({ key, locales, detail }) =>
					`${key} (${locales.join(", ")}): ${detail}`,
			),
		).toEqual([
			"item (ru): it has no _few, _many form: those counts show the _other text, where i18next shows the key's name.",
			'friend_male (en, ru): it may be i18next\'s context male of friend, which grai imports as a key of its own. Call it where { context: "male" } was passed.',
		]);
	});

	it("prefixes each key with its namespace when a locale's directory holds several files", async () => {
		const m = await imported("i18next", {
			"en/common.json": { title: "Shop" },
			"en/cart.json": { title: "Cart" },
			"ru/common.json": { title: "Магазин" },
			"ru/cart.json": { title: "Корзина" },
		}).load();

		expect(Object.keys(m).sort()).toEqual(["cart_title", "common_title"]);
	});

	it("writes nothing when two source keys become one grai key, or a catalog exists", () => {
		const collision = imported("i18next", {
			"en.json": { a: { b: "nested" }, a_b: "flat" },
			"ru.json": { a: { b: "вложенный" }, a_b: "плоский" },
		});

		expect(collision.result.errors.map((error) => error.message)).toEqual([
			'source/en.json: "a.b": the keys a.b, a_b all become the grai key a_b, ignoring case. Rename all but one in the source.',
		]);
		expect(existsSync(join(collision.dir, "messages"))).toBe(false);

		const again = imported("i18next", {
			"en.json": { a: "x" },
			"ru.json": { a: "y" },
		});
		expect(
			importCatalogs(join(again.dir, "grai.config.json"), "i18next", [
				join(again.dir, "source"),
			]).errors.map((error) => error.code),
		).toEqual(["catalog-exists", "catalog-exists"]);
	});
});

describe("grai import --from icu", () => {
	it("converts plural with # and =0, select, and choices nested and in sequence", async () => {
		const m = await imported("icu", {
			"en.json": {
				items: "{n, plural, =0 {No items} one {# item} other {# items}}",
				owner:
					"{g, select, male {He} other {They}} found {n, plural, one {# cat} other {# cats}}.",
				nested:
					"{g, select, male {{n, plural, one {his cat} other {his # cats}}} other {their cats}}",
			},
			"ru.json": {
				items:
					"{n, plural, =0 {Нет} one {# товар} few {# товара} other {# товаров}}",
				owner:
					"{g, select, male {Он} other {Они}}: {n, plural, one {# кот} other {# котов}}.",
				nested:
					"{g, select, male {{n, plural, one {его кот} other {его коты: #}}} other {их коты}}",
			},
		}).load();

		expect(counts((n) => m.items?.({ n }))).toEqual([
			"No items",
			"1 item",
			"2 items",
			"5 items",
			"21 items",
		]);
		expect(counts((n) => m.items?.({ n }, { locale: "ru" }))).toEqual([
			"Нет",
			"1 товар",
			"2 товара",
			"5 товаров",
			"21 товар",
		]);
		expect(m.owner?.({ g: "female", n: 2 })).toBe("They found 2 cats.");
		expect(m.nested?.({ g: "male", n: 3 })).toBe("his 3 cats");
		expect(m.nested?.({ g: "x", n: 3 }, { locale: "ru" })).toBe("их коты");
	});

	it("converts selectordinal with # and =n into an ordinal plural", async () => {
		const m = await imported("icu", {
			"en.json": {
				rank: "{n, selectordinal, =1 {first} one {#st} two {#nd} few {#rd} other {#th}}",
			},
			"ru.json": { rank: "{n, selectordinal, other {#-й}}" },
		}).load();

		expect([1, 2, 3, 4, 11, 21, 1002].map((n) => m.rank?.({ n }))).toEqual([
			"first",
			"2nd",
			"3rd",
			"4th",
			"11th",
			"21st",
			"1,002nd",
		]);
		expect(m.rank?.({ n: 1000 }, { locale: "ru" })).toBe(
			`${new Intl.NumberFormat("ru").format(1000)}-й`,
		);
	});

	it("turns tags into markup and reads ICU's apostrophes", async () => {
		const m = await imported(
			"icu",
			{
				"en.json": {
					bold: "Hi <b>{name}</b>, it's '{literal}' and ''quoted''",
				},
			},
			["en"],
		).load();

		expect(m.bold?.parts?.({ name: "Ana" })).toEqual([
			{ type: "text", value: "Hi " },
			{ type: "markup-start", name: "b", options: {}, attributes: {} },
			{ type: "text", value: "Ana" },
			{ type: "markup-end", name: "b", options: {}, attributes: {} },
			{ type: "text", value: ", it's {literal} and 'quoted'" },
		]);
	});

	it("formats # and number, date and time arguments as intl-messageformat does", async () => {
		const { result, load } = imported(
			"icu",
			{
				"en.json": {
					items: "{n, plural, one {# item} other {# items}}",
					share: "{n, number, percent} done",
					day: "{d, date, short}",
					at: "{d, time}",
				},
			},
			["en"],
		);
		const m = await load();
		const when = new Date(Date.UTC(2026, 9, 24, 15, 5, 30));
		const format = (options: Intl.DateTimeFormatOptions) =>
			new Intl.DateTimeFormat("en", options).format(when);

		expect(m.items?.({ n: 1000 })).toBe("1,000 items");
		expect(m.share?.({ n: 0.25 })).toBe("25% done");
		expect(m.day?.({ d: when })).toBe(
			format({ year: "2-digit", month: "numeric", day: "numeric" }),
		);
		expect(m.at?.({ d: when })).toBe(
			format({ hour: "numeric", minute: "numeric", second: "numeric" }),
		);
		expect(result.changed).toEqual([]);
	});

	it("leaves out a style it does not convert, and offsets", () => {
		const { result } = imported(
			"icu",
			{
				"en.json": {
					price: "{value, number, ::currency/EUR}",
					others: "{n, plural, offset:1 other {# others}}",
				},
			},
			["en"],
		);

		expect(
			result.leftOut.map(({ key, detail }) => `${key}: ${detail}`),
		).toEqual([
			"price: {value, number, ::currency/EUR} formats with a style grai import does not convert. Write it as {value :number} with the options it needs.",
			"others: {n, plural, offset:1} subtracts an offset from the count, which grai does not support.",
		]);
	});
});
