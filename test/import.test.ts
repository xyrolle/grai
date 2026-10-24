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
				price: "{{value, number}}",
			},
			"ru.json": {
				title: "Корзина",
				see: "См. $t(title)",
				rank_ordinal_other: "{{count}}-й",
				price: "{{value, number}}",
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
				key: "price",
				locales: ["en", "ru"],
				detail:
					"{{value, number}} formats the value, which grai does not support yet. Format it before the call and pass the text.",
			},
		]);
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
