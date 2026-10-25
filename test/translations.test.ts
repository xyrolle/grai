import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportLocale, mergeDocument } from "../src/translations.ts";
import { project } from "./project.ts";
import { handLaid, schemaEntry } from "./sources.ts";

const items = (match: Record<string, string>) => [
	{
		declarations: ["input count", "local countPlural = count: plural"],
		selectors: ["count", "countPlural"],
		match,
	},
];

const english = {
	cart_title: "Your cart & <more>",
	cart_total: "Total {amount :number style=currency currency=EUR}",
	cart_terms: "Read the {#link}terms{/link}, {name}{#br/}",
	cart_items: items({
		"count=0,countPlural=*": "No items",
		"count=*,countPlural=one": "{count} item",
		"count=*,countPlural=*": "{count} items",
	}),
};

/** The XLIFF of a locale, with each named unit's target set to the given inline content. */
function translated(xliff: string, targets: Record<string, string>): string {
	return xliff.replaceAll(
		/<unit id="([^"]+)"[\s\S]*?<\/unit>/g,
		(unit, id: string) =>
			targets[id] === undefined
				? unit
				: unit
						.replace(/<target>[\s\S]*?<\/target>\n\t*/, "")
						.replace("</source>", `</source><target>${targets[id]}</target>`),
	);
}

async function exported(config: string, locale: string): Promise<string> {
	const result = await exportLocale(config, locale, {
		json: false,
		untranslated: false,
	});
	if ("errors" in result) throw new Error(result.errors[0]?.message);
	return result.document;
}

describe("grai export", () => {
	it("writes a unit per message, a unit per form the locale's plurals need, and each code protected", async () => {
		const { config } = project({ en: english, ru: { cart_title: "Корзина" } });

		const xliff = await exported(config, "ru");

		expect(
			[...xliff.matchAll(/<unit id="([^"]+)"/g)].map(([, id]) => id),
		).toEqual([
			"cart_title",
			"cart_total",
			"cart_terms",
			"cart_items.count.0.countPlural.-2a-",
			"cart_items.count.-2a-.countPlural.one",
			"cart_items.count.-2a-.countPlural.few",
			"cart_items.count.-2a-.countPlural.many",
			"cart_items.count.-2a-.countPlural.other",
		]);
		expect(xliff).toContain(
			"<source>Your cart &amp; &lt;more&gt;</source>\n\t\t\t\t<target>Корзина</target>",
		);
		expect(xliff).toContain(
			'<source>Read the <pc id="tag-link" dispStart="{#link}" dispEnd="{/link}">terms</pc>, <ph id="name" disp="{name}"/><ph id="tag-br" disp="{#br/}"/></source>',
		);
		expect(xliff).toContain(
			'<note category="variant">count: any other value; countPlural: few, as for 2, 3, 4, 22, 23, 24, …</note>',
		);
	});

	it("writes only the untranslated keys when asked, and JSON for scripts", async () => {
		const { config } = project({
			en: english,
			de: { ...english, cart_title: "Ihr Warenkorb" },
		});

		const result = await exportLocale(config, "de", {
			json: true,
			untranslated: true,
		});

		expect(result).toMatchObject({ units: 5 });
		const units = "document" in result ? JSON.parse(result.document).units : [];
		expect(units[0]).toEqual({
			id: "cart_total",
			key: "cart_total",
			source: "Total {amount :number style=currency currency=EUR}",
		});
		expect(units.map((unit: { id: string }) => unit.id)).not.toContain(
			"cart_title",
		);
	});

	it("takes a key identicalToBase lists for the locale as translated, with the base text its translation", async () => {
		const { config } = project(
			{
				en: { unit_km: "km", cart_title: "Your cart" },
				de: { unit_km: "km", cart_title: "Your cart" },
			},
			{ identicalToBase: { de: ["unit_km"] } },
		);
		const units = async (untranslated: boolean) => {
			const result = await exportLocale(config, "de", {
				json: true,
				untranslated,
			});
			return "document" in result ? JSON.parse(result.document).units : [];
		};

		expect(await units(true)).toEqual([
			{ id: "cart_title", key: "cart_title", source: "Your cart" },
		]);
		expect(await units(false)).toEqual([
			{ id: "unit_km", key: "unit_km", source: "km", target: "km" },
			{ id: "cart_title", key: "cart_title", source: "Your cart" },
		]);
	});

	it("merges nothing from a document of a listed key merged back as it was exported", async () => {
		const { dir, config } = project(
			{ en: { unit_km: "km" }, de: { unit_km: "km" } },
			{ identicalToBase: { de: ["unit_km"] } },
		);
		const exported = await exportLocale(config, "de", {
			json: true,
			untranslated: false,
		});
		const file = join(dir, "de-units.json");
		writeFileSync(file, "document" in exported ? exported.document : "");

		expect(await mergeDocument(config, file)).toMatchObject({
			messages: 0,
			units: 0,
		});
	});
	it("starts each plural form from the base text for the same counts, so the count shows where the locale needs it", async () => {
		const files = [
			{
				declarations: ["input count", "local countPlural = count: plural"],
				selectors: ["countPlural"],
				match: {
					"countPlural=one": "One file",
					"countPlural=*": "{count} files",
				},
			},
		];
		const { config } = project({ en: { files }, de: { files }, ru: { files } });
		const sources = async (locale: string) => {
			const result = await exportLocale(config, locale, {
				json: true,
				untranslated: false,
			});
			const units: { id: string; source: string }[] =
				"document" in result ? JSON.parse(result.document).units : [];
			return units.map(({ id, source }) => [id, source]);
		};

		expect(await sources("de")).toEqual([
			["files.countPlural.one", "One file"],
			["files.countPlural.other", "{count} files"],
		]);
		// ru's one is 1, 21, 31…: English's other, which shows the count.
		expect(await sources("ru")).toEqual([
			["files.countPlural.one", "{count} files"],
			["files.countPlural.few", "{count} files"],
			["files.countPlural.many", "{count} files"],
			["files.countPlural.other", "{count} files"],
		]);
	});

	it("writes a unit per ordinal form the locale needs, each with the counts it is for", async () => {
		const place = [
			{
				declarations: ["input n", "local nOrdinal = n: plural type=ordinal"],
				selectors: ["nOrdinal"],
				match: {
					"nOrdinal=one": "{n}st",
					"nOrdinal=two": "{n}nd",
					"nOrdinal=few": "{n}rd",
					"nOrdinal=*": "{n}th",
				},
			},
		];
		const { config } = project({ en: { place }, sv: { place } });

		const xliff = await exported(config, "sv");

		expect(
			[...xliff.matchAll(/<unit id="([^"]+)"/g)].map(([, id]) => id),
		).toEqual(["place.nOrdinal.one", "place.nOrdinal.other"]);
		expect(xliff).toContain(
			'<note category="variant">nOrdinal: one, as for 1, 2, 21, 22, 31, 32, …</note>',
		);
	});
	it("writes a number selector's exact keys as they are, and a unit per category the locale needs", async () => {
		const files = [
			{
				declarations: ["input count", "local n = count: number"],
				selectors: ["n"],
				match: {
					"n=0": "No files",
					"n=one": "One file",
					"n=*": "{n} files",
				},
			},
		];
		const { config } = project({ en: { files }, ru: { files } });

		const result = await exportLocale(config, "ru", {
			json: true,
			untranslated: false,
		});
		const units: { id: string; source: string; note: string }[] =
			"document" in result ? JSON.parse(result.document).units : [];

		expect(units.map(({ id, source }) => [id, source])).toEqual([
			["files.n.0", "No files"],
			["files.n.one", "{n} files"],
			["files.n.few", "{n} files"],
			["files.n.many", "{n} files"],
			["files.n.other", "{n} files"],
		]);
		expect(units[0]?.note).toBe("n: 0");
	});

	it("notes the counts each form of a rounding number is for, as its options show them", async () => {
		const weights = [
			{
				declarations: [
					"input kg",
					"local n = kg: number minimumFractionDigits=1",
				],
				selectors: ["n"],
				match: { "n=one": "{n} kilogram", "n=*": "{n} kilograms" },
			},
		];
		const { config } = project({ en: { weights }, ru: { weights } });

		const result = await exportLocale(config, "ru", {
			json: true,
			untranslated: false,
		});
		const units: { id: string; source: string; note: string }[] =
			"document" in result ? JSON.parse(result.document).units : [];

		expect(units.map(({ id, source, note }) => [id, source, note])).toEqual([
			[
				"weights.n.one",
				"{n} kilograms",
				"n: one, as for no count its options show",
			],
			[
				"weights.n.few",
				"{n} kilograms",
				"n: few, as for no count its options show",
			],
			[
				"weights.n.many",
				"{n} kilograms",
				"n: many, as for no count its options show",
			],
			[
				"weights.n.other",
				"{n} kilograms",
				"n: other, as for 0, 1, 2, 3, 4, 5, 0.5, 1.5, 2.5, …",
			],
		]);
	});

	it("gives each code of a unit an id of its own that XML can hold, whatever its tag is named", async () => {
		const legend = "{#dot/} {#dot/} {#dot.2/} {#a&b/}";
		const { config } = project({ en: { legend }, de: { legend } });

		const xliff = await exported(config, "de");
		const ids = [...xliff.matchAll(/<ph id="([^"]+)"/g)].map(([, id]) => id);

		expect(ids).toEqual(["tag-dot", "tag-dot.2", "tag-dot-2e-2", "tag-a-26-b"]);
	});

	it("writes tags that cross as a start and an end code each, which a merge reads back", async () => {
		const styles = "{#b}bold {#i}both{/b} italic{/i}";
		const { dir, config, load } = project({ en: { styles }, de: { styles } });
		const xliff = await exported(config, "de");
		const file = join(dir, "de.xlf");
		writeFileSync(
			file,
			translated(xliff, {
				styles:
					'<sc id="tag-b"/>fett <sc id="tag-i"/>beides<ec startRef="tag-b"/> kursiv<ec startRef="tag-i"/>',
			}),
		);

		const merged = await mergeDocument(config, file);
		const { m } = await load();

		expect(xliff).toContain(
			'<source><sc id="tag-b" disp="{#b}"/>bold <sc id="tag-i" disp="{#i}"/>both<ec startRef="tag-b" disp="{/b}"/> italic<ec startRef="tag-i" disp="{/i}"/></source>',
		);
		expect(merged).toMatchObject({ messages: 1, refused: [] });
		expect(m.styles?.({}, { locale: "de" })).toBe("fett beides kursiv");
	});
});

describe("grai merge", () => {
	it("writes the translations into the locale's catalog, in one write, then compiles", async () => {
		const { dir, config, load } = project({ en: english, ru: english });
		const file = join(dir, "ru.xlf");
		writeFileSync(
			file,
			translated(await exported(config, "ru"), {
				cart_title: "Корзина &amp; &lt;ещё&gt;",
				cart_total: 'Итого <ph id="amount"/>',
				cart_terms:
					'Прочтите <pc id="tag-link">условия</pc>, <ph id="name"/><ph id="tag-br"/>',
				"cart_items.count.0.countPlural.-2a-": "Нет товаров",
				"cart_items.count.-2a-.countPlural.one": '<ph id="count"/> товар',
				"cart_items.count.-2a-.countPlural.few": '<ph id="count"/> товара',
				"cart_items.count.-2a-.countPlural.many": '<ph id="count"/> товаров',
				"cart_items.count.-2a-.countPlural.other": '<ph id="count"/> товара',
			}),
		);

		const merged = await mergeDocument(config, file);
		const { m } = await load();

		expect(merged).toMatchObject({
			messages: 4,
			units: 8,
			refused: [],
			result: { errors: [] },
		});
		expect(
			[0, 1, 3, 5, 21].map((count) =>
				m.cart_items?.({ count }, { locale: "ru" }),
			),
		).toEqual(["Нет товаров", "1 товар", "3 товара", "5 товаров", "21 товар"]);
		expect(m.cart_terms?.({ name: "Ана" }, { locale: "ru" })).toBe(
			"Прочтите условия, Ана",
		);
		expect(m.cart_title?.({}, { locale: "ru" })).toBe("Корзина & <ещё>");
	});

	it("keeps each variant's own formatter where two placeholders of a message share a name", async () => {
		const price = [
			{
				declarations: ["input precision", "input amount"],
				selectors: ["precision"],
				match: {
					"precision=whole":
						"Rounded: {amount :number maximumFractionDigits=0}",
					"precision=*":
						"Exact: {amount :number minimumFractionDigits=2 maximumFractionDigits=2}",
				},
			},
		];
		const { dir, config, load } = project({ en: { price }, de: { price } });
		const file = join(dir, "de.xlf");
		const xliff = await exported(config, "de");
		const [whole, exact] = [...xliff.matchAll(/<ph id="([^"]+)"/g)].map(
			([, id]) => id,
		);
		writeFileSync(
			file,
			translated(xliff, {
				"price.precision.whole": `Gerundet: <ph id="${whole}"/>`,
				"price.precision.-2a-": `Genau: <ph id="${exact}"/>`,
			}),
		);

		const merged = await mergeDocument(config, file);
		const { m } = await load();

		expect(merged).toMatchObject({ messages: 1, refused: [] });
		expect(
			["whole", "exact"].map((precision) =>
				m.price?.({ precision, amount: 1.234 }, { locale: "de" }),
			),
		).toEqual(["Gerundet: 1", "Genau: 1,23"]);
	});

	it("gives back a translation's own formatter unchanged, where the base formats its placeholder otherwise", async () => {
		const { dir, config } = project({
			en: { cart_total: "Total {amount}", cart_title: "Your cart" },
			de: {
				cart_total: "Summe {amount :number minimumFractionDigits=2}",
				cart_title: "Your cart",
			},
		});
		const file = join(dir, "de.xlf");
		writeFileSync(
			file,
			translated(await exported(config, "de"), {
				cart_title: "Ihr Warenkorb",
			}),
		);
		const catalog = join(dir, "messages", "de.json");

		const merged = await mergeDocument(config, file);

		expect(merged).toMatchObject({ messages: 1, units: 1, refused: [] });
		expect(JSON.parse(readFileSync(catalog, "utf8")).cart_total).toBe(
			"Summe {amount :number minimumFractionDigits=2}",
		);
	});

	it("refuses a stale unit, an invalid one and an incomplete plural, merges the rest, and skips units without a target", async () => {
		const { dir, config } = project({ en: english, ru: english });
		const xliff = await exported(config, "ru");
		const file = join(dir, "ru.xlf");
		writeFileSync(
			file,
			translated(xliff, {
				cart_title: "Корзина",
				cart_total: 'Итого <ph id="sum"/>',
				cart_terms: "Прочтите условия",
				"cart_items.count.-2a-.countPlural.one": '<ph id="count"/> товар',
			}),
		);
		const base = join(dir, "messages", "en.json");
		writeFileSync(
			base,
			readFileSync(base, "utf8").replace("Your cart &", "Your basket &"),
		);

		const merged = await mergeDocument(config, file);

		expect(merged).toMatchObject({ messages: 0, units: 0 });
		expect(
			"refused" in merged ? merged.refused.map((error) => error.message) : [],
		).toEqual([
			'ru.xlf: "cart_title" (ru): unit cart_title: the unit\'s source is not the base text any more: Your basket & <more>. Export again.',
			'ru.xlf: "cart_total" (ru): unit cart_total: the translation places a code its message does not have. Use only the source\'s codes.',
			'ru.xlf: "cart_terms" (ru): the translation shows no input, where the base shows {name}.',
			'ru.xlf: "cart_items" (ru): the message needs a translation of every form, and lacks cart_items.count.0.countPlural.-2a-, cart_items.count.-2a-.countPlural.few, cart_items.count.-2a-.countPlural.many, cart_items.count.-2a-.countPlural.other.',
		]);
	});

	it("refuses a unit a file gives twice, rather than take either translation", async () => {
		const { dir, config } = project({
			en: { cart_title: "Your cart" },
			de: { cart_title: "Your cart" },
		});
		const units = [
			{ id: "cart_title", source: "Your cart", target: "Ihr Warenkorb" },
			{ id: "cart_title", source: "Your cart", target: "Dein Warenkorb" },
		];
		const file = join(dir, "de.json");
		writeFileSync(
			file,
			JSON.stringify({ srcLang: "en", trgLang: "de", units }),
		);

		const merged = await mergeDocument(config, file);

		expect(merged).toMatchObject({ messages: 0, units: 0 });
		expect(
			"refused" in merged ? merged.refused.map((error) => error.message) : [],
		).toEqual([
			'de.json: "cart_title" (de): unit cart_title: the file gives the unit 2 times. Keep one.',
		]);
	});

	it("reads a file as a translation tool writes it back", async () => {
		const { dir, config, load } = project({ en: english, ru: english });
		const file = join(dir, "ru.xlf");
		writeFileSync(
			file,
			`<?xml version='1.0' encoding='UTF-8' standalone='yes'?>
<!-- Exported by a translation tool -->
<xliff version='2.0' srcLang='en' trgLang='ru' xmlns='urn:oasis:names:tc:xliff:document:2.0' xmlns:mda='urn:oasis:names:tc:xliff:metadata:2.0'>
  <file id='messages'>
    <group id='g1'>
      <unit id='cart_title' name='cart_title'>
        <mda:metadata><mda:metaGroup><mda:meta type='reviewer'>A</mda:meta></mda:metaGroup></mda:metadata>
        <notes><note>Reviewed</note></notes>
        <segment id='s1' state='final' subState='tool:approved'>
          <source>Your cart &amp; </source>
          <target>Корзина &amp; </target>
        </segment>
        <ignorable><source>&lt;more&gt;</source></ignorable>
      </unit>
      <unit id='cart_terms'>
        <segment state='translated'>
          <source>Read the <pc id='tag-link' dispStart='{#link}' dispEnd='{/link}'>terms</pc>, <ph id='name'/><ph id='tag-br'/></source>
          <target><ph id='name'/>, прочтите <pc id='tag-link'><mrk id='m1' type='term'>условия</mrk></pc><![CDATA[ & ]]><ph id='tag-br'/></target>
        </segment>
      </unit>
    </group>
  </file>
</xliff>
`,
		);

		const merged = await mergeDocument(config, file);
		const { m } = await load();

		expect(merged).toMatchObject({ messages: 2, refused: [] });
		expect(m.cart_title?.({}, { locale: "ru" })).toBe("Корзина & <more>");
		expect(m.cart_terms?.parts?.({ name: "Ана" }, { locale: "ru" })).toEqual([
			{ type: "text", value: "Ана" },
			{ type: "text", value: ", прочтите " },
			{ type: "markup-start", name: "link", options: {}, attributes: {} },
			{ type: "text", value: "условия" },
			{ type: "markup-end", name: "link", options: {}, attributes: {} },
			{ type: "text", value: " & " },
			{ type: "markup-standalone", name: "br", options: {}, attributes: {} },
		]);
	});

	it("writes a translation in place, leaving every other byte of the catalog as it is written", async () => {
		const { dir, config } = project({
			en: { cart_title: "Your cart", cart_total: "Total {count}" },
			de: { cart_title: "Ihr Warenkorb", cart_total: "Total {count}" },
		});
		const title = '"cart_title":"Ihr Warenkorb \\u00e9"';
		const catalog = join(dir, "messages", "de.json");
		writeFileSync(
			catalog,
			handLaid(schemaEntry, title, '"cart_total" :  "Total {count}"'),
		);
		const result = await exportLocale(config, "de", {
			json: true,
			untranslated: true,
		});
		const document = "document" in result ? JSON.parse(result.document) : {};
		for (const unit of document.units) unit.target = "Summe {count}";
		const file = join(dir, "de-units.json");
		writeFileSync(file, JSON.stringify(document));

		await mergeDocument(config, file);

		expect(readFileSync(catalog, "utf8")).toBe(
			handLaid(schemaEntry, title, '"cart_total" :  "Summe {count}"'),
		);
	});

	it("merges JSON units, whose targets keep each placeholder as the source writes it", async () => {
		const { dir, config, load } = project({ en: english, de: english });
		const result = await exportLocale(config, "de", {
			json: true,
			untranslated: false,
		});
		const document = "document" in result ? JSON.parse(result.document) : {};
		const targets: Record<string, string> = {
			cart_total: "Summe {amount :number style=currency currency=EUR}",
			cart_terms: "Lies die {#link}Bedingungen{/link}, {name}{#br/}",
			cart_title: "Ihr Warenkorb {amount}",
		};
		for (const unit of document.units) unit.target = targets[unit.id];
		const file = join(dir, "de.json");
		writeFileSync(file, JSON.stringify(document));

		const merged = await mergeDocument(config, file);
		const { m } = await load();

		expect(m.cart_total?.({ amount: 5 }, { locale: "de" })).toBe(
			`Summe ${new Intl.NumberFormat("de", { style: "currency", currency: "EUR" }).format(5)}`,
		);
		expect(
			"refused" in merged ? merged.refused.map((error) => error.message) : [],
		).toEqual([
			'de.json: "cart_title" (de): unit cart_title: the translation places a code its message does not have. Use only the source\'s codes.',
		]);
	});
});

describe("a message with declarations and no selectors", () => {
	const price = (pattern: string) => [
		{
			declarations: ["input amount", "local price = amount: number"],
			selectors: [],
			match: { "": pattern },
		},
	];

	/** The locale's JSON units, as export writes them. */
	async function units(config: string, untranslated: boolean) {
		const result = await exportLocale(config, "de", {
			json: true,
			untranslated,
		});
		return "document" in result ? JSON.parse(result.document).units : [];
	}

	it("merges a translation into the message, keeping its declarations", async () => {
		const { dir, config, load } = project({
			en: { price: price("Price {price}") },
			de: { price: price("Price {price}") },
		});
		const document = {
			srcLang: "en",
			trgLang: "de",
			units: await units(config, false),
		};
		for (const unit of document.units) unit.target = "Preis {price}";
		const file = join(dir, "de.json");
		writeFileSync(file, JSON.stringify(document));

		const merged = await mergeDocument(config, file);
		const { m } = await load();

		expect(merged).toMatchObject({ messages: 1, refused: [] });
		expect(m.price?.({ amount: 1234.5 }, { locale: "de" })).toBe(
			"Preis 1.234,5",
		);
	});

	it("exports the translation it has as the unit's target, translated", async () => {
		const { config } = project({
			en: { price: price("Price {price}") },
			de: { price: price("Preis {price}") },
		});

		expect(await units(config, false)).toEqual([
			{
				id: "price",
				key: "price",
				source: "Price {price}",
				target: "Preis {price}",
			},
		]);
		expect(await units(config, true)).toEqual([]);
	});
});

describe("a translation whose declarations differ from the base's", () => {
	const items = (declaration: string, one: string, other: string) => [
		{
			declarations: [
				"input count",
				"input amount",
				"local countPlural = count: plural",
				declaration,
			],
			selectors: ["countPlural"],
			match: { "countPlural=one": one, "countPlural=*": other },
		},
	];

	it("keeps them through a merge of one of its forms", async () => {
		const { dir, config, load } = project({
			en: {
				items: items(
					"local price = amount: number",
					"{count} item for {price}",
					"{count} items for {price}",
				),
			},
			de: {
				items: items(
					"local price = amount: currency currency=EUR",
					"{count} Artikel für {price}",
					"{count} Artikel für {price}",
				),
			},
		});
		const result = await exportLocale(config, "de", {
			json: true,
			untranslated: false,
		});
		const document = "document" in result ? JSON.parse(result.document) : {};
		const [one] = document.units;
		one.target = "{count} Stück für {price}";
		const file = join(dir, "de.json");
		writeFileSync(file, JSON.stringify({ ...document, units: [one] }));

		const merged = await mergeDocument(config, file);
		const { m } = await load();

		expect(merged).toMatchObject({ messages: 1, refused: [] });
		expect(m.items?.({ count: 1, amount: 5 }, { locale: "de" })).toBe(
			`1 Stück für ${new Intl.NumberFormat("de", { style: "currency", currency: "EUR" }).format(5)}`,
		);
	});
	it("takes the base's declaration of a local it lacks, which a code from the base reads", async () => {
		const declared = (declarations: string[], pattern: string) => [
			{ declarations, selectors: [], match: { "": pattern } },
		];
		const { dir, config, load } = project({
			en: {
				price: declared(
					["input amount", "local price = amount: number"],
					"Price {price}",
				),
			},
			de: { price: declared(["input amount"], "Preis {amount}") },
		});
		const units = [
			{ id: "price", source: "Price {price}", target: "Preis: {price}" },
		];
		const file = join(dir, "de.json");
		writeFileSync(
			file,
			JSON.stringify({ srcLang: "en", trgLang: "de", units }),
		);

		const merged = await mergeDocument(config, file);
		const { m } = await load();

		expect(merged).toMatchObject({ messages: 1, refused: [] });
		expect(m.price?.({ amount: 1234.5 }, { locale: "de" })).toBe(
			"Preis: 1.234,5",
		);
	});
});

describe("a translation whose selectors differ from the base's", () => {
	/** The locale's JSON units, as export writes them. */
	async function units(config: string, locale: string) {
		const result = await exportLocale(config, locale, {
			json: true,
			untranslated: false,
		});
		return "document" in result ? JSON.parse(result.document).units : [];
	}

	/** Merges the locale's units with the given targets, by unit id. */
	async function merge(
		dir: string,
		config: string,
		locale: string,
		targets: Record<string, string>,
	) {
		const given = (await units(config, locale))
			.filter((unit: { id: string }) => targets[unit.id] !== undefined)
			.map((unit: { id: string }) => ({ ...unit, target: targets[unit.id] }));
		const file = join(dir, `${locale}.json`);
		writeFileSync(
			file,
			JSON.stringify({ srcLang: "en", trgLang: locale, units: given }),
		);
		return mergeDocument(config, file);
	}

	const invited = [
		{
			declarations: ["input name", "input gender"],
			selectors: ["gender"],
			match: {
				"gender=female": "Vous êtes invitée, {name}",
				"gender=*": "Vous êtes invité, {name}",
			},
		},
	];

	it("exports a unit per form of the locale's own selection, each from the base text", async () => {
		const { config } = project({
			en: { invited: "You're invited, {name}" },
			fr: { invited },
		});

		expect(
			(await units(config, "fr")).map(
				({ id, source, target }: Record<string, string>) => [
					id,
					source,
					target,
				],
			),
		).toEqual([
			[
				"invited.gender.female",
				"You're invited, {name}",
				"Vous êtes invitée, {name}",
			],
			[
				"invited.gender.-2a-",
				"You're invited, {name}",
				"Vous êtes invité, {name}",
			],
		]);
	});

	it("merges a form into the locale's own selection, keeping its others", async () => {
		const { dir, config, load } = project({
			en: { invited: "You're invited, {name}" },
			fr: { invited },
		});

		const merged = await merge(dir, config, "fr", {
			"invited.gender.female": "Bienvenue, {name}, vous êtes invitée",
		});
		const { m } = await load();

		expect(merged).toMatchObject({ messages: 1, refused: [] });
		expect(
			["female", "male"].map((gender) =>
				m.invited?.({ name: "Ana", gender }, { locale: "fr" }),
			),
		).toEqual(["Bienvenue, Ana, vous êtes invitée", "Vous êtes invité, Ana"]);
	});

	it("keeps a form the locale writes for a value the base has no form of", async () => {
		const files = (match: Record<string, string>) => [
			{
				declarations: ["input count", "local countPlural = count: plural"],
				selectors: ["count", "countPlural"],
				match,
			},
		];
		const { dir, config, load } = project({
			en: {
				files: files({
					"count=0,countPlural=*": "No files",
					"count=*,countPlural=one": "{count} file",
					"count=*,countPlural=*": "{count} files",
				}),
			},
			de: {
				files: files({
					"count=0,countPlural=*": "Keine Dateien",
					"count=1,countPlural=*": "Eine Datei",
					"count=*,countPlural=*": "{count} Dateien",
				}),
			},
		});

		const merged = await merge(dir, config, "de", {
			"files.count.0.countPlural.-2a-": "Gar keine Dateien",
		});
		const { m } = await load();

		expect(merged).toMatchObject({ messages: 1, refused: [] });
		expect(
			[0, 1, 2].map((count) => m.files?.({ count }, { locale: "de" })),
		).toEqual(["Gar keine Dateien", "Eine Datei", "2 Dateien"]);
	});

	it("exports a locale's message without the base's selection as one unit, from the base text for any count", async () => {
		const files = [
			{
				declarations: ["input count", "local countPlural = count: plural"],
				selectors: ["countPlural"],
				match: {
					"countPlural=one": "One file",
					"countPlural=*": "{count} files",
				},
			},
		];
		const { config } = project({
			en: { files },
			ja: { files: "{count} ファイル" },
		});

		expect(await units(config, "ja")).toEqual([
			{
				id: "files",
				key: "files",
				source: "{count} files",
				target: "{count} ファイル",
			},
		]);
	});
});
