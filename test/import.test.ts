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

/** What the import says of a message whose values i18next escapes. */
const escapingDetail =
	"i18next escapes the values of {{name}} for HTML by default, and grai gives them as they are, for the page to escape as React, Vue and Svelte do when they show text. Where this text is set as HTML, escape the values first.";

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

	it("imports a key named __proto__ as any other", async () => {
		const key = "__proto__";
		const { result, catalog, load } = imported("i18next", {
			"en.json": JSON.parse(`{"${key}": "Prototype"}`),
			"ru.json": JSON.parse(`{"${key}": "Прототип"}`),
		});
		const m = await load();

		expect(result).toMatchObject({ keys: 1, errors: [] });
		expect(Object.hasOwn(catalog("en"), key)).toBe(true);
		expect(m[key]?.({}, { locale: "ru" })).toBe("Прототип");
	});

	it("turns plural suffixes into one message that chooses on count, _zero as an exact 0", async () => {
		const project = imported("i18next", {
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
		});
		const m = await project.load();

		expect(readFileSync(join(project.dir, "messages", "ru.json"), "utf8")).toBe(
			`${JSON.stringify(project.catalog("ru"), null, "\t")}\n`,
		);
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

	it("reads {{-name}}, {{name}} and $t(key) as i18next does, each in the text the one before left", async () => {
		const messages = {
			title: "Shop",
			spaced: "{{ -name}}",
			empty: "a {{}} b",
			across: "{{x {{-name}} y}}",
			nested: "$t($t(title)",
			refilled: "{{'{{- name}}{{name}}{{name}}",
		};
		const { result, load } = imported("i18next", {
			"en.json": messages,
			"ru.json": messages,
		});
		const m = await load();

		expect(m.empty?.()).toBe("a {{}} b");
		expect(m.across?.({ name: "Ana" })).toBe("{{x Ana y}}");
		expect(m.nested?.()).toBe("$t(Shop");
		expect(
			result.leftOut.map(({ key, detail }) => `${key}: ${detail}`),
		).toEqual([
			"spaced: {{ -name}} reads an input whose name is not a JavaScript identifier, which grai does not support. Pass it as one input, such as {{name}}.",
			"refilled: {{name}} stands earlier too, in text i18next leaves as written, and i18next fills that one instead. Write the earlier text another way.",
		]);
	});

	it("inlines $t(key) of a text, and leaves out in every locale what grai cannot express", async () => {
		const { result, load } = imported("i18next", {
			"en.json": {
				title: "Cart",
				see: "See $t(title)",
				loud: "{{value, uppercase}}",
				inherited: "{{value, constructor}}",
			},
			"ru.json": {
				title: "Корзина",
				see: "См. $t(title)",
				loud: "{{value, uppercase}}",
				inherited: "{{value, constructor}}",
			},
		});
		const m = await load();

		expect(m.see?.()).toBe("See Cart");
		expect(Object.keys(m)).toEqual(["see", "title"]);
		expect(result.leftOut).toEqual([
			{
				file: "source/en.json",
				key: "loud",
				locales: ["en", "ru"],
				detail:
					"{{value, uppercase}} formats the value as uppercase, which grai import does not convert. Write it with one of grai's formatting functions.",
			},
			{
				file: "source/en.json",
				key: "inherited",
				locales: ["en", "ru"],
				detail:
					"{{value, constructor}} formats the value as constructor, which grai import does not convert. Write it with one of grai's formatting functions.",
			},
		]);
	});

	it("turns _ordinal_ forms into a key of their own that chooses on count's ordinal category", async () => {
		const { result, load } = imported("i18next", {
			"en.json": {
				rank_ordinal_one: "{{count}}st",
				rank_ordinal_two: "{{count}}nd",
				rank_ordinal_other: "{{count}}th",
			},
			"ru.json": {
				rank_ordinal_one: "never chosen",
				rank_ordinal_other: "{{count}}-й",
			},
		});
		const m = await load();

		expect(counts((count) => m.rank_ordinal?.({ count }))).toEqual([
			"0th",
			"1st",
			"2nd",
			"5th",
			"21st",
		]);
		expect(m.rank_ordinal?.({ count: 2 }, { locale: "ru" })).toBe("2-й");
		expect(
			result.changed.map(
				({ key, locales, detail }) =>
					`${key} (${locales.join(", ")}): ${detail}`,
			),
		).toEqual([
			"rank_ordinal (en, ru): its _ordinal_ forms become a key of their own, ending in _ordinal. Call it where { ordinal: true } was passed.",
			"rank_ordinal (en): it has no _ordinal_few form: those counts show the _ordinal_other text, where i18next shows the key's name.",
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

	it("formats with i18next's currency, relativetime, list and its formats' options as i18next does, through Intl", async () => {
		const catalog = {
			euro: "{{value, currency(EUR)}}",
			yen: "{{value, currency(currency: JPY; minimumFractionDigits: 2; maximumFractionDigits: 2)}}",
			signed: "{{value, currency(currency: EUR; signDisplay: always)}}",
			digits: "{{value, number(minimumFractionDigits: 2)}}",
			ago: "{{value, relativetime}}",
			quarters: "{{value, relativetime(range: quarter; style: narrow)}}",
			names: "{{names, list}}",
			either: "{{names, list(type: disjunction)}}",
			long: "{{value, datetime(dateStyle: long; timeZone: UTC)}}",
			utc: "{{value, datetime(timeZone: UTC)}}",
		};
		const { catalog: written, load } = imported("i18next", {
			"en.json": catalog,
			"ru.json": catalog,
		});
		const m = await load();
		const names = ["Ana", "Ion", "Maria"];
		const when = Date.UTC(2026, 9, 24, 23, 5);
		const intl = (options: Intl.NumberFormatOptions) =>
			new Intl.NumberFormat("ru", options).format(-1234.5);

		expect(
			[m.euro, m.yen, m.signed, m.digits].map((message) =>
				message?.({ value: -1234.5 }, { locale: "ru" }),
			),
		).toEqual([
			intl({ style: "currency", currency: "EUR" }),
			intl({
				style: "currency",
				currency: "JPY",
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}),
			intl({ style: "currency", currency: "EUR", signDisplay: "always" }),
			intl({ minimumFractionDigits: 2 }),
		]);
		expect(m.ago?.({ value: -2 })).toBe(
			new Intl.RelativeTimeFormat("en").format(-2, "day"),
		);
		expect(m.quarters?.({ value: 1 })).toBe(
			new Intl.RelativeTimeFormat("en", { style: "narrow" }).format(
				1,
				"quarter",
			),
		);
		expect([m.names, m.either].map((message) => message?.({ names }))).toEqual([
			new Intl.ListFormat("en").format(names),
			new Intl.ListFormat("en", { type: "disjunction" }).format(names),
		]);
		expect(
			[m.long, m.utc].map((message) => message?.({ value: when })),
		).toEqual([
			new Intl.DateTimeFormat("en", {
				dateStyle: "long",
				timeZone: "UTC",
			}).format(when),
			new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format(when),
		]);
		expect(written("en")).toMatchObject({
			euro: "{value :currency currency=EUR}",
			yen: "{value :currency currency=JPY fractionDigits=2}",
			signed: "{value :number style=currency currency=EUR signDisplay=always}",
		});
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

	it("reports each message whose values i18next escapes for HTML, which grai gives as they are", () => {
		const catalog = {
			greeting: "Hi {{name}}",
			raw: "Hi {{- name}}",
			guests: "With {{names, list}}",
			price: "Costs {{value, number}}",
			item_one: "One item",
			item_other: "{{count}} items",
		};
		const { result } = imported("i18next", { "en.json": catalog }, ["en"]);

		expect(
			result.changed.map(({ key, detail }) => `${key}: ${detail}`),
		).toEqual(["greeting", "guests"].map((key) => `${key}: ${escapingDetail}`));
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

	it("chooses on an input in several places of a message, as one selection", async () => {
		const m = await imported("icu", {
			"en.json": {
				agree:
					"{n, plural, =0 {No} one {# cat} other {# cats}} {n, plural, one {is} other {are}} here",
				said: "{g, select, male {He} other {They}} said {g, select, male {his} other {their}}",
				within:
					"{n, plural, =0 {none} one {one} other {{n, plural, =1 {never} other {#}}}}",
				crossed:
					"{g, select, a {A} other {B}} {h, select, x {X} other {{g, select, b {Gb} other {Go}}}}",
			},
			"ru.json": {
				agree:
					"{n, plural, one {# кот} few {# кота} other {# котов}} {n, plural, one {здесь} other {тут}}",
				said: "{g, select, male {Он} other {Они}}: {g, select, male {его} other {их}}",
				within: "{n, plural, other {#}}",
				crossed: "{g, select, other {B}} {h, select, other {X}}",
			},
		}).load();

		expect(counts((n) => m.agree?.({ n }))).toEqual([
			"No are here",
			"1 cat is here",
			"2 cats are here",
			"5 cats are here",
			"21 cats are here",
		]);
		expect(counts((n) => m.agree?.({ n }, { locale: "ru" }))).toEqual([
			"0 котов тут",
			"1 кот здесь",
			"2 кота тут",
			"5 котов тут",
			"21 кот здесь",
		]);
		expect(m.said?.({ g: "male" })).toBe("He said his");
		expect(m.said?.({ g: "x" })).toBe("They said their");
		expect([0, 1, 2].map((n) => m.within?.({ n }))).toEqual([
			"none",
			"one",
			"2",
		]);
		expect(
			[
				["a", "x"],
				["b", "x"],
				["b", "y"],
				["c", "y"],
			].map(([g, h]) => m.crossed?.({ g, h })),
		).toEqual(["A X", "B X", "B Gb", "B Go"]);
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

	it("quotes with an apostrophe only before {, }, <, > and a plural's #, as intl-messageformat does", async () => {
		const m = await imported(
			"icu",
			{
				"en.json": {
					pipe: "Select '|x'",
					end: "the cats'",
					counted:
						"{n, plural, other {'#' is #}} {g, select, other {'#' is #}}",
				},
			},
			["en"],
		).load();

		expect(m.pipe?.()).toBe("Select '|x'");
		expect(m.end?.()).toBe("the cats'");
		expect(m.counted?.({ n: 2, g: "x" })).toBe("# is 2 '#' is #");
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

	it("formats with a number or date skeleton as intl-messageformat reads it, through Intl", async () => {
		const catalog = {
			price: "{value, number, ::currency/EUR}",
			exact: "{value, number, ::currency/JPY .00 sign-always}",
			share: "{value, number, ::percent .0}",
			speed:
				"{value, number, ::unit/speed-kilometer-per-hour unit-width-full-name}",
			short: "{value, number, ::compact-short}",
			plain: "{value, number, ::.00# group-off}",
			digits: "{value, number, ::@@@}",
			when: "{d, date, ::yMMMd}",
			time: "{d, time, ::Hmm}",
		};
		const { catalog: written, load } = imported("icu", {
			"en.json": catalog,
			"ru.json": catalog,
		});
		const m = await load();
		const value = 1234.567;
		const d = Date.UTC(2026, 9, 24, 15, 5);
		const number = (options: Intl.NumberFormatOptions) =>
			new Intl.NumberFormat("ru", options).format(value);

		expect(
			[m.price, m.exact, m.share, m.speed, m.short, m.plain, m.digits].map(
				(message) => message?.({ value }, { locale: "ru" }),
			),
		).toEqual([
			number({ style: "currency", currency: "EUR" }),
			number({
				style: "currency",
				currency: "JPY",
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
				signDisplay: "always",
			}),
			number({
				style: "percent",
				minimumFractionDigits: 1,
				maximumFractionDigits: 1,
			}),
			number({
				style: "unit",
				unit: "kilometer-per-hour",
				unitDisplay: "long",
				currencyDisplay: "name",
			}),
			number({ notation: "compact", compactDisplay: "short" }),
			number({
				minimumFractionDigits: 2,
				maximumFractionDigits: 3,
				useGrouping: false,
			}),
			number({ minimumSignificantDigits: 3, maximumSignificantDigits: 3 }),
		]);
		expect(m.when?.({ d })).toBe(
			new Intl.DateTimeFormat("en", {
				year: "numeric",
				month: "short",
				day: "numeric",
			}).format(d),
		);
		expect(m.time?.({ d })).toBe(
			new Intl.DateTimeFormat("en", {
				hourCycle: "h23",
				hour: "numeric",
				minute: "2-digit",
			}).format(d),
		);
		expect(written("en")).toMatchObject({
			price: "{value :currency currency=EUR}",
			share: "{value :percent minimumFractionDigits=1 maximumFractionDigits=1}",
		});
	});

	it("leaves out a style it does not convert, a skeleton stem or a date field Intl has no option for, and offsets", () => {
		const { result } = imported(
			"icu",
			{
				"en.json": {
					price: "{value, number, currency}",
					inherited: "{value, number, constructor}",
					inherited_stem: "{value, number, ::constructor}",
					scaled: "{value, number, ::scale/100}",
					week: "{d, date, ::yw}",
					others: "{n, plural, offset:1 other {# others}}",
				},
			},
			["en"],
		);

		expect(
			result.leftOut.map(({ key, detail }) => `${key}: ${detail}`),
		).toEqual([
			"price: {value, number, currency} formats with a style grai import does not convert. Write it as {value :number} with the options it needs.",
			"inherited: {value, number, constructor} formats with a style grai import does not convert. Write it as {value :number} with the options it needs.",
			"inherited_stem: {value, number, ::constructor} uses the skeleton stem constructor, which grai import does not convert. Write the call with the Intl options it needs.",
			"scaled: {value, number, ::scale/100} uses the skeleton stem scale/100, which grai import does not convert. Write the call with the Intl options it needs.",
			"week: {d, date, ::yw} uses the date field w, which grai import does not convert. Write the call with the Intl options it needs.",
			"others: {n, plural, offset:1} subtracts an offset from the count, which grai does not support.",
		]);
	});
});

describe("grai import's mapping, grai.import.json", () => {
	const mappingOf = (dir: string): unknown =>
		JSON.parse(readFileSync(join(dir, "grai.import.json"), "utf8"));

	it("maps each key i18next calls, its namespace included, to the grai key and the inputs it takes", () => {
		const { dir } = imported(
			"i18next",
			{
				"en/common.json": {
					title: "Shop",
					cart: { items_one: "{{count}} item", items_other: "{{count}} items" },
					place_ordinal_one: "{{count}}st",
					place_ordinal_two: "{{count}}nd",
					place_ordinal_few: "{{count}}rd",
					place_ordinal_other: "{{count}}th",
					friend: "A friend",
					friend_male: "{{name}}, a boyfriend",
				},
				"en/home.json": { welcome: "Welcome, {{name}}" },
				"de/common.json": {
					title: "Laden",
					cart: {
						items_one: "{{count}} Artikel",
						items_other: "{{count}} Artikel",
					},
					place_ordinal_other: "{{count}}.",
					friend: "Ein Freund",
					friend_male: "{{name}}, ein Freund",
				},
				"de/home.json": { welcome: "Willkommen, {{name}}" },
			},
			["en", "de"],
		);

		expect(mappingOf(dir)).toEqual({
			from: "i18next",
			keys: {
				"common:title": { key: "common_title", inputs: [] },
				"common:cart.items": { key: "common_cart_items", inputs: ["count"] },
				"common:place_ordinal": {
					key: "common_place_ordinal",
					inputs: ["count"],
				},
				"common:friend": { key: "common_friend", inputs: [] },
				"common:friend_male": { key: "common_friend_male", inputs: ["name"] },
				"home:welcome": { key: "home_welcome", inputs: ["name"] },
			},
		});
	});

	it("names a file's namespace even when the grai keys leave it out, as the only one", () => {
		const { dir } = imported("i18next", {
			"en/common.json": { title: "Shop" },
			"ru/common.json": { title: "Магазин" },
		});

		expect(mappingOf(dir)).toEqual({
			from: "i18next",
			keys: { "common:title": { key: "title", inputs: [] } },
		});
	});

	it("maps each ICU id, flat or nested, and marks a message with markup, one entry per line", () => {
		const { dir } = imported(
			"icu",
			{
				"en.json": {
					"app.title": "Shop",
					nav: { home: "Home" },
					intro: "Read <b>{name}</b>",
					items: "{n, plural, one {# item} other {# items}}",
				},
			},
			["en"],
		);
		const expected = {
			from: "icu",
			keys: {
				"app.title": { key: "app_title", inputs: [] },
				"nav.home": { key: "nav_home", inputs: [] },
				intro: { key: "intro", inputs: ["name"], markup: true },
				items: { key: "items", inputs: ["n"] },
			},
		};

		expect(readFileSync(join(dir, "grai.import.json"), "utf8")).toBe(
			`${JSON.stringify(expected, null, "\t")}\n`,
		);
	});

	it("leaves out the keys the import left out, and writes no mapping when it writes no catalog", () => {
		const { dir } = imported("i18next", {
			"en.json": { ok: "Fine", ago: "{{p, uppercase}}" },
			"ru.json": { ok: "Хорошо", ago: "{{p, uppercase}}" },
		});
		const collision = imported("i18next", {
			"en.json": { a: { b: "nested" }, a_b: "flat" },
			"ru.json": { a: { b: "вложенный" }, a_b: "плоский" },
		});

		expect(mappingOf(dir)).toEqual({
			from: "i18next",
			keys: { ok: { key: "ok", inputs: [] } },
		});
		expect(existsSync(join(collision.dir, "grai.import.json"))).toBe(false);
	});
});
