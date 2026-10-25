import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { optionInput } from "../src/format-inputs.ts";
import { errorsOf, outputFile, project, thrown } from "./project.ts";

const when = new Date(Date.UTC(2026, 9, 24, 15, 5, 30));

const catalog = {
	price: "{amount :number style=currency currency=$code}",
	refund: "{amount :currency currency=$code}",
	distance: "{length :number style=unit unit=$unit unitDisplay=long}",
	shipped: "{when :datetime timeZone=$zone}",
	total: [
		{
			declarations: [
				"input amount",
				"input code",
				"local price = amount: number style=currency currency=$code",
			],
			selectors: [],
			match: { "": "Total {price}" },
		},
	],
};

describe("a formatter's options that inputs give", () => {
	it("formats with the currency, the unit or the time zone each call gives", async () => {
		const { m } = await project({ en: catalog, de: catalog }).load();

		for (const locale of ["en", "de"]) {
			const options = { locale };
			const number = (value: number, intl: Intl.NumberFormatOptions) =>
				new Intl.NumberFormat(locale, intl).format(value);
			for (const code of ["EUR", "USD", "EUR"]) {
				const expected = number(1234.5, { style: "currency", currency: code });
				expect(m.price?.({ amount: 1234.5, code }, options)).toBe(expected);
				expect(m.refund?.({ amount: 1234.5, code }, options)).toBe(expected);
			}
			expect(m.distance?.({ length: 3, unit: "kilometer" }, options)).toBe(
				number(3, { style: "unit", unit: "kilometer", unitDisplay: "long" }),
			);
			for (const zone of ["UTC", "Asia/Tokyo"]) {
				expect(m.shipped?.({ when, zone }, options)).toBe(
					new Intl.DateTimeFormat(locale, {
						dateStyle: "medium",
						timeStyle: "short",
						timeZone: zone,
					}).format(when),
				);
			}
			expect(m.total?.({ amount: 5, code: "MDL" }, options)).toBe(
				`Total ${number(5, { style: "currency", currency: "MDL" })}`,
			);
		}
	});

	it("types each input that gives an option as a string", async () => {
		const { dir, compile } = project({ en: catalog });
		expect((await compile()).errors).toEqual([]);

		const keys = join(dir, "out", "keys");
		const declarations = readdirSync(keys)
			.filter((file) => file.endsWith(".d.ts"))
			.map((file) => readFileSync(join(keys, file), "utf8"))
			.join("");
		for (const declaration of [
			"price: Message<{ amount: number; code: string }>",
			"refund: Message<{ amount: number; code: string }>",
			"distance: Message<{ length: number; unit: string }>",
			"shipped: Message<{ when: Date | number; zone: string }>",
			"total: Message<{ amount: number; code: string }>",
		]) {
			expect(declarations).toContain(`export declare const ${declaration};`);
		}
	});

	it("writes one formatter for each locale and the options inputs give, whatever the inputs are called", async () => {
		const { dir, compile } = project({
			en: {
				price: "{amount :number style=currency currency=$code}",
				refund: "{amount :number style=currency currency=$currency}",
				fee: "{amount :number style=currency currency=EUR}",
			},
		});
		expect((await compile()).errors).toEqual([]);

		const formats = readFileSync(await outputFile(dir, "formats.js"), "utf8");
		expect([...formats.matchAll(/export const (\w+)/g)]).toHaveLength(2);
	});

	it("throws a GraiError naming a value an input gives that Intl refuses", async () => {
		const { m } = await project({ en: catalog }).load();

		expect(
			thrown(() => m.price?.({ amount: 1, code: "dollars" })),
		).toMatchObject({
			name: "GraiError",
			code: "format-option-invalid",
		});
		expect(
			String(thrown(() => m.shipped?.({ when, zone: "Mars/Olympus" }))),
		).toContain('timeZone "Mars/Olympus"');
		expect(m.price?.({ amount: 1, code: "USD" })).toBe(
			new Intl.NumberFormat("en", {
				style: "currency",
				currency: "USD",
			}).format(1),
		);
	});
});

describe("a formatter's options that inputs give: errors", () => {
	it("is an error for an option of how a value looks, an input that is no name or a local, an option without its style, two options, and options Intl refuses", async () => {
		expect(
			await errorsOf({
				en: {
					a_style: "{amount :number style=$style}",
					no_name: "{amount :number style=currency currency=$}",
					a_local: [
						{
							declarations: [
								"input amount",
								"input count",
								"local countPlural = count: plural",
							],
							selectors: [],
							match: {
								"": "{amount :number style=currency currency=$countPlural}",
							},
						},
					],
					no_style: "{amount :number currency=$code}",
					two: "{amount :number style=currency currency=$code unit=$unit}",
					refused:
						"{amount :number style=currency currency=$code maximumFractionDigits=101}",
				},
			}),
		).toEqual([
			'message-invalid: messages/en.json: "a_local" (en): an option takes countPlural, a local. An option takes an input: name the input itself.',
			'unsupported: messages/en.json: "a_style" (en): {amount :number style=$style}: "style=$style" takes its value from an input, which only a currency, a unit and a time zone can: how a value looks is the message\'s to write. Write the value itself.',
			'message-invalid: messages/en.json: "no_name" (en): {amount :number style=currency currency=$}: "currency=$" names no input. Write it as currency=$name.',
			'message-invalid: messages/en.json: "no_style" (en): {amount :number currency=$code}: currency=$code gives a currency, which only style=currency formats with. Write style=currency in the call.',
			`message-invalid: messages/en.json: "refused" (en): {amount :number style=currency currency=$code maximumFractionDigits=101}: Intl cannot format with these options: ${intlError(() => new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR", maximumFractionDigits: 101 }))}`,
			'message-invalid: messages/en.json: "two" (en): {amount :number style=currency currency=$code unit=$unit}: "unit=$unit" takes a second option from an input, after currency. A call takes one: a currency and a unit go with different styles.',
		]);
	});
});

/** The message Intl throws with, which differs between engines. */
function intlError(make: () => unknown): string {
	try {
		make();
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
	throw new Error("expected Intl to throw");
}

it("takes an option from an input only when it is one of the input options' own, never one every object has", () => {
	for (const option of ["constructor", "toString", "__proto__"]) {
		const token = `${option}=$x`;
		expect(() =>
			optionInput("number", option, "$x", undefined, {
				source: `{n :number ${token}}`,
				token,
			}),
		).toThrow(
			`"${token}" takes its value from an input, which only a currency`,
		);
	}
});
