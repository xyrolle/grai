import { describe, expect, it } from "vitest";
import { exportLocale } from "../src/translations.ts";
import { errorsOf, project } from "./project.ts";

describe("a literal operand", () => {
	it("shows a quoted literal as its text, its escapes read, and gives it translators as a code", async () => {
		const catalog = {
			brand: "Sign in with {|Gmail|}",
			piped: "a {|b\\|c|} d",
		};
		const { m, config } = await (async () => {
			const created = project({ en: catalog, de: catalog });
			return { ...(await created.load()), config: created.config };
		})();

		expect([m.brand?.(), m.piped?.()]).toEqual([
			"Sign in with Gmail",
			"a b|c d",
		]);
		const result = await exportLocale(config, "de", {
			json: true,
			untranslated: false,
		});
		const units: { id: string; source: string }[] =
			"document" in result ? JSON.parse(result.document).units : [];
		expect(units.find(({ id }) => id === "brand")?.source).toBe(
			"Sign in with {|Gmail|}",
		);
	});

	it("formats a literal operand with its function in each locale", async () => {
		const catalog = {
			total: "Total {|1000| :number}",
			bare: "{1000 :integer} items",
			share: "{|0.5| :percent} done",
			price: "{|9.5| :currency currency=EUR}",
		};
		const { m } = await project({ en: catalog, de: catalog }).load();

		for (const locale of ["en", "de"]) {
			const options = { locale };
			const format = (value: number, intl?: Intl.NumberFormatOptions) =>
				new Intl.NumberFormat(locale, intl).format(value);
			expect([
				m.total?.({}, options),
				m.bare?.({}, options),
				m.share?.({}, options),
				m.price?.({}, options),
			]).toEqual([
				`Total ${format(1000)}`,
				`${format(1000, { maximumFractionDigits: 0 })} items`,
				`${format(0.5, { style: "percent" })} done`,
				format(9.5, { style: "currency", currency: "EUR" }),
			]);
		}
	});

	it("is an error for a literal a function cannot read, or one whose quote is not closed", async () => {
		expect(
			await errorsOf({
				en: {
					dated: "{|2026-01-01| :date}",
					listed: "{|a| :list}",
					word: "{|many| :number}",
					open: "{|1000 :number}",
				},
			}),
		).toEqual([
			'unsupported: messages/en.json: "dated" (en): {|2026-01-01| :date} formats a literal with :date, which grai does not support: a literal operand is a number, for a number function or :relativetime. Pass the value as an input.',
			'unsupported: messages/en.json: "listed" (en): {|a| :list} formats a literal with :list, which grai does not support: a literal operand is a number, for a number function or :relativetime. Pass the value as an input.',
			'message-invalid: messages/en.json: "open" (en): {|1000 :number}: a quoted literal is not closed by |.',
			'message-invalid: messages/en.json: "word" (en): {|many| :number}: "many" is not a number, which :number formats.',
		]);
	});
});
