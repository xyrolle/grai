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
			'ru.xlf: "cart_terms" (ru): the translation reads no input, where the base reads {name}.',
			'ru.xlf: "cart_items" (ru): the message needs a translation of every form, and lacks cart_items.count.0.countPlural.-2a-, cart_items.count.-2a-.countPlural.few, cart_items.count.-2a-.countPlural.many, cart_items.count.-2a-.countPlural.other.',
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
