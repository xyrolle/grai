import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { errorsOf, outputFile, project } from "./project.ts";

const when = new Date(Date.UTC(2026, 9, 24, 15, 5, 30));

describe("a formatted placeholder", () => {
	it("formats a number as Intl.NumberFormat does for the locale, with the options it is given", async () => {
		const catalog = {
			cart_count: "{count :number} items",
			cart_total: "{amount :number style=currency currency=EUR}",
			cart_share: "{share :number style=percent}",
			cart_price: "{amount: number minimumFractionDigits=2 useGrouping=never}",
			cart_rounded: "{amount :integer}",
		};
		const { m } = await project({ en: catalog, de: catalog }).load();

		for (const locale of ["en", "de"]) {
			const options = { locale };
			const format = (value: number, intl?: Intl.NumberFormatOptions) =>
				new Intl.NumberFormat(locale, intl).format(value);
			expect(m.cart_count?.({ count: 1234.5 }, options)).toBe(
				`${format(1234.5)} items`,
			);
			expect(m.cart_total?.({ amount: 1234.5 }, options)).toBe(
				format(1234.5, { style: "currency", currency: "EUR" }),
			);
			expect(m.cart_share?.({ share: 0.256 }, options)).toBe(
				format(0.256, { style: "percent" }),
			);
			expect(m.cart_price?.({ amount: 1234 }, options)).toBe(
				format(1234, { minimumFractionDigits: 2, useGrouping: false }),
			);
			expect(m.cart_rounded?.({ amount: 2.5 }, options)).toBe(
				format(2.5, { maximumFractionDigits: 0 }),
			);
		}
	});

	it("groups digits as useGrouping names it: true and false as Paraglide writes them, or Intl's own modes", async () => {
		const catalog = {
			always: "{n: number useGrouping=true}",
			never: "{n: number useGrouping=false}",
			min2: "{n :number useGrouping=min2}",
			compact: "{n :number notation=compact useGrouping=true}",
		};
		const { m } = await project({ es: catalog, en: catalog }).load();

		for (const locale of ["es", "en"]) {
			const options = { locale };
			const format = (value: number, intl: Intl.NumberFormatOptions) =>
				new Intl.NumberFormat(locale, intl).format(value);
			expect(m.always?.({ n: 1000 }, options)).toBe(
				format(1000, { useGrouping: true }),
			);
			expect(m.never?.({ n: 1000 }, options)).toBe(
				format(1000, { useGrouping: false }),
			);
			expect(m.min2?.({ n: 1000 }, options)).toBe(
				format(1000, { useGrouping: "min2" }),
			);
			expect(m.compact?.({ n: 1e15 }, options)).toBe(
				format(1e15, { notation: "compact", useGrouping: true }),
			);
		}
		expect(m.always?.({ n: 1000 })).toBe("1.000");
		expect(
			await errorsOf({ en: { grouping: "{n :number useGrouping=yes}" } }),
		).toEqual([
			'message-invalid: messages/en.json: "grouping" (en): {n :number useGrouping=yes}: "useGrouping=yes" needs one of always, auto, min2, true, false, never.',
		]);
	});

	it("takes a relative time's unit from an input, as Intl takes it with each value", async () => {
		const catalog = { ago: "{n :relativetime unit=$unit numeric=auto}" };
		const { m } = await project({ en: catalog, de: catalog }).load();

		for (const locale of ["en", "de"]) {
			const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
			expect(m.ago?.({ n: -1, unit: "day" }, { locale })).toBe(
				format.format(-1, "day"),
			);
			expect(m.ago?.({ n: 2, unit: "weeks" }, { locale })).toBe(
				format.format(2, "weeks"),
			);
		}
		expect(() => m.ago?.({ n: 2, unit: "fortnight" })).toThrow(
			'An input gave unit "fortnight", which is not a unit of time: year, quarter, month, week, day, hour, minute, second, or one of them plural.',
		);
	});

	it("formats a date as Intl.DateTimeFormat does, with MessageFormat 2's defaults when no option shapes it", async () => {
		const { m } = await project({
			en: {
				shipped: "{when :datetime}",
				shipped_on: "{when :date}",
				shipped_at: "{when :time timeZone=UTC}",
				shipped_long: "{when :date dateStyle=long timeZone=UTC}",
				shipped_month: "{when :datetime month=long year=numeric}",
			},
		}).load();
		const format = (options: Intl.DateTimeFormatOptions) =>
			new Intl.DateTimeFormat("en", options).format(when);

		expect(m.shipped?.({ when })).toBe(
			format({ dateStyle: "medium", timeStyle: "short" }),
		);
		expect(m.shipped_on?.({ when })).toBe(format({ dateStyle: "medium" }));
		expect(m.shipped_at?.({ when: when.getTime() })).toBe(
			format({ timeStyle: "short", timeZone: "UTC" }),
		);
		expect(m.shipped_long?.({ when })).toBe(
			format({ dateStyle: "long", timeZone: "UTC" }),
		);
		expect(m.shipped_month?.({ when })).toBe(
			format({ month: "long", year: "numeric" }),
		);
	});

	it("formats a local declared with a function wherever a variant shows it, and in markup parts", async () => {
		const { m } = await project({
			en: {
				cart_price: [
					{
						declarations: [
							"input amount",
							"input count",
							"local price = amount: number style=currency currency=USD",
							"local countPlural = count: plural",
						],
						selectors: ["countPlural"],
						match: {
							"countPlural=one": "{price} for one",
							"countPlural=*": "{price} for {count :number}",
						},
					},
				],
				cart_terms: "{#b}{amount :number}{/b} due",
			},
		}).load();
		const usd = new Intl.NumberFormat("en", {
			style: "currency",
			currency: "USD",
		}).format(5);

		expect(m.cart_price?.({ amount: 5, count: 1 })).toBe(`${usd} for one`);
		expect(m.cart_price?.({ amount: 5, count: 1200 })).toBe(`${usd} for 1,200`);
		expect(m.cart_terms?.parts?.({ amount: 1200 })).toEqual([
			{ type: "markup-start", name: "b", options: {}, attributes: {} },
			{ type: "text", value: "1,200" },
			{ type: "markup-end", name: "b", options: {}, attributes: {} },
			{ type: "text", value: " due" },
		]);
	});

	it("formats a percent, a currency and a unit as Intl.NumberFormat does with their style", async () => {
		const catalog = {
			share: "{share :percent}",
			share_exact: "{share :percent maximumFractionDigits=1}",
			price: "{amount :currency currency=EUR}",
			price_yen: "{amount :currency currency=JPY fractionDigits=2}",
			price_auto: "{amount :currency currency=JPY fractionDigits=auto}",
			speed: "{speed :unit unit=kilometer-per-hour unitDisplay=long}",
		};
		const { m } = await project({ en: catalog, de: catalog }).load();

		for (const locale of ["en", "de"]) {
			const options = { locale };
			const format = (value: number, intl: Intl.NumberFormatOptions) =>
				new Intl.NumberFormat(locale, intl).format(value);
			expect(m.share?.({ share: 0.256 }, options)).toBe(
				format(0.256, { style: "percent" }),
			);
			expect(m.share_exact?.({ share: 0.256 }, options)).toBe(
				format(0.256, { style: "percent", maximumFractionDigits: 1 }),
			);
			expect(m.price?.({ amount: 1234.5 }, options)).toBe(
				format(1234.5, { style: "currency", currency: "EUR" }),
			);
			expect(m.price_yen?.({ amount: 1234.5 }, options)).toBe(
				format(1234.5, {
					style: "currency",
					currency: "JPY",
					minimumFractionDigits: 2,
					maximumFractionDigits: 2,
				}),
			);
			expect(m.price_auto?.({ amount: 1234.5 }, options)).toBe(
				format(1234.5, { style: "currency", currency: "JPY" }),
			);
			expect(m.speed?.({ speed: 90 }, options)).toBe(
				format(90, {
					style: "unit",
					unit: "kilometer-per-hour",
					unitDisplay: "long",
				}),
			);
		}
	});

	it("formats a relative time and a list as Intl.RelativeTimeFormat and Intl.ListFormat do", async () => {
		const catalog = {
			due: "Due {days :relativetime unit=day}",
			due_auto: "Due {days :relativetime unit=day numeric=auto}",
			guests: "With {names :list}",
			either: "{names :list type=disjunction style=short}",
		};
		const { m } = await project({ en: catalog, de: catalog }).load();
		const names = ["Ana", "Ion", "Maria"];

		for (const locale of ["en", "de"]) {
			const options = { locale };
			const relative = (days: number, intl?: Intl.RelativeTimeFormatOptions) =>
				new Intl.RelativeTimeFormat(locale, intl).format(days, "day");
			const list = (intl?: Intl.ListFormatOptions) =>
				new Intl.ListFormat(locale, intl).format(names);
			expect(m.due?.({ days: -1 }, options)).toBe(`Due ${relative(-1)}`);
			expect(m.due_auto?.({ days: 1 }, options)).toBe(
				`Due ${relative(1, { numeric: "auto" })}`,
			);
			expect(m.guests?.({ names }, options)).toBe(`With ${list()}`);
			expect(m.either?.({ names }, options)).toBe(
				list({ type: "disjunction", style: "short" }),
			);
		}
	});

	it("writes one formatter for each locale and options, however many messages use it", async () => {
		const catalog = {
			cart_count: "{count :number} items",
			cart_left: "{count :number} left",
			cart_share: "{share :number style=percent}",
		};
		const { dir, compile } = project({ en: catalog, de: catalog });
		expect((await compile()).errors).toEqual([]);

		const formats = readFileSync(await outputFile(dir, "formats.js"), "utf8");
		expect(
			[...formats.matchAll(/export const (\w+)/g)].map(([, name]) => name),
		).toEqual([
			"number_de",
			"number_de_549b87f8",
			"number_en",
			"number_en_549b87f8",
		]);
	});
});

describe("a formatted placeholder's errors", () => {
	it("is an error for a function, an option or an option's value grai cannot format with", async () => {
		expect(
			await errorsOf({
				en: {
					a_function: "{amount :uppercase}",
					no_currency: "{amount :currency currencyDisplay=code}",
					a_usage: "{distance :unit unit=meter usage=road}",
					fraction_digits:
						"{amount :currency currency=EUR fractionDigits=some}",
					no_unit: "{days :relativetime numeric=auto}",
					an_input: "{amount :number minimumFractionDigits=$digits}",
					a_unit: "{days :relativetime unit=fortnight}",
					an_option: "{amount :number minimumFractionDigit=2}",
					a_value: "{amount :number minimumFractionDigits=two}",
					an_intl_value: "{amount :number style=currency}",
					twice: "{amount :integer signDisplay=always signDisplay=never}",
				},
			}),
		).toEqual([
			'unsupported: messages/en.json: "a_function" (en): {amount :uppercase} calls :uppercase, which grai does not support; the formatting functions are :string, :number, :integer, :percent, :offset, :currency, :unit, :relativetime, :list, :datetime, :date, :time.',
			'message-invalid: messages/en.json: "a_unit" (en): {days :relativetime unit=fortnight}: "unit=fortnight" needs a unit of time: year, years, quarter, quarters, month, months, week, weeks, day, days, hour, hours, minute, minutes, second, seconds.',
			'unsupported: messages/en.json: "a_usage" (en): {distance :unit unit=meter usage=road}: usage converts the value into the units the locale prefers, which Intl cannot do, so grai does not support it. Convert the value before the call, and leave usage out.',
			'message-invalid: messages/en.json: "a_value" (en): {amount :number minimumFractionDigits=two}: "minimumFractionDigits=two" needs a whole number.',
			'unsupported: messages/en.json: "an_input" (en): {amount :number minimumFractionDigits=$digits}: "minimumFractionDigits=$digits" takes its value from an input, which only a currency, a unit and a time zone can: how a value looks is the message\'s to write. Write the value itself.',
			`message-invalid: messages/en.json: "an_intl_value" (en): {amount :number style=currency}: Intl cannot format with these options: ${intlError(() => new Intl.NumberFormat(undefined, { style: "currency" }))}`,
			'message-invalid: messages/en.json: "an_option" (en): {amount :number minimumFractionDigit=2}: "minimumFractionDigit=2" is not an option of :number, or is given twice. Its options are select, style, currency, currencyDisplay, currencySign, unit, unitDisplay, notation, compactDisplay, numberingSystem, signDisplay, useGrouping, minimumIntegerDigits, minimumFractionDigits, maximumFractionDigits, minimumSignificantDigits, maximumSignificantDigits, trailingZeroDisplay, roundingPriority, roundingIncrement, roundingMode.',
			'message-invalid: messages/en.json: "fraction_digits" (en): {amount :currency currency=EUR fractionDigits=some}: "fractionDigits=some" needs a whole number or auto.',
			'message-invalid: messages/en.json: "no_currency" (en): {amount :currency currencyDisplay=code}: :currency needs the option currency, such as currency=EUR.',
			'message-invalid: messages/en.json: "no_unit" (en): {days :relativetime numeric=auto}: :relativetime needs the option unit, such as unit=day.',
			'message-invalid: messages/en.json: "twice" (en): {amount :integer signDisplay=always signDisplay=never}: "signDisplay=never" is not an option of :integer, or is given twice. Its options are select, signDisplay, useGrouping, minimumIntegerDigits, maximumSignificantDigits.',
		]);
	});

	it("is an error for options Intl refuses each time they come, whatever options the same formatter took before", async () => {
		const refused = intlError(
			() => new Intl.NumberFormat(undefined, { style: "currency" }),
		);
		expect(
			await errorsOf({
				en: {
					a_percent: "{amount :number style=percent}",
					b_currency: "{amount :number style=currency}",
					c_currency: "{amount :number style=currency}",
				},
			}),
		).toEqual([
			`message-invalid: messages/en.json: "b_currency" (en): {amount :number style=currency}: Intl cannot format with these options: ${refused}`,
			`message-invalid: messages/en.json: "c_currency" (en): {amount :number style=currency}: Intl cannot format with these options: ${refused}`,
		]);
	});

	it("is an error for options Intl refuses after more formats than validation keeps, in turn", async () => {
		const refused = intlError(
			() => new Intl.NumberFormat(undefined, { style: "currency" }),
		);
		// 80 keys of 40 formats Intl takes, more than the 32 kept, then one it refuses.
		const taken = Object.fromEntries(
			Array.from({ length: 80 }, (_, index) => [
				`k${String(index).padStart(2, "0")}`,
				`{amount :number minimumFractionDigits=${index % 2} maximumFractionDigits=${((index >> 1) % 20) + 2}}`,
			]),
		);
		expect(
			await errorsOf({
				en: { ...taken, z_currency: "{amount :number style=currency}" },
			}),
		).toEqual([
			`message-invalid: messages/en.json: "z_currency" (en): {amount :number style=currency}: Intl cannot format with these options: ${refused}`,
		]);
	});

	it("is an error to select on a date or on a number in another notation, or to format a local", async () => {
		expect(
			await errorsOf({
				en: {
					a_date: [
						{
							declarations: ["input when", "local day = when: date"],
							selectors: ["day"],
							match: { "day=*": "{day}" },
						},
					],
					rounded: [
						{
							declarations: [
								"input amount",
								"local price = amount: number notation=compact signDisplay=always",
							],
							selectors: ["price"],
							match: { "price=*": "{price}" },
						},
					],
					reformatted: [
						{
							declarations: ["input amount", "local price = amount: number"],
							selectors: [],
							match: { "": "{price :integer}" },
						},
					],
				},
			}),
		).toEqual([
			'unsupported: messages/en.json: "a_date" (en): it selects on day, a :date value, which MessageFormat 2 does not select on. Select on the input, or on a :number local of it.',
			'unsupported: messages/en.json: "reformatted" (en): it formats price, a local, which grai does not support. Format the input it is made from.',
			'unsupported: messages/en.json: "rounded" (en): it selects on price, a :number with notation, which shows more than digits, and Intl.PluralRules has no category for that. Select on a local without it, and format with it in the pattern.',
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
