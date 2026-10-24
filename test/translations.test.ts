import { describe, expect, it } from "vitest";
import { exportLocale } from "../src/translations.ts";
import { project } from "./project.ts";

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
