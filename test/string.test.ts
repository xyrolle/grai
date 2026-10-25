import { describe, expect, it } from "vitest";
import { errorsOf, project, thrown } from "./project.ts";

/** A message that selects on `local s = <input>: string`. */
const onString = (input: string, match: Record<string, string>) => [
	{
		declarations: [`input ${input}`, `local s = ${input}: string`],
		selectors: ["s"],
		match,
	},
];

describe(":string", () => {
	it("formats a value as its text, as a placeholder without a function does", async () => {
		const { m } = await project({
			en: { greeting: "Hi {name :string}", plain: "Hi {name}" },
		}).load();

		for (const name of ["Ana", 2, 10n, ["Ana", "Ion"]]) {
			expect(m.greeting?.({ name })).toBe(m.plain?.({ name }));
		}
	});

	it("selects on a local by its text, keys and value compared in Unicode's NFC, and shows the value as given", async () => {
		const { m } = await project({
			en: {
				pronoun: onString("gender", {
					"s=f": "she",
					"s=m": "he",
					"s=*": "they",
				}),
				cafe: onString("place", { "s=café": "the café", "s=*": "{s}" }),
			},
		}).load();

		expect(["f", "m", "x", 1].map((gender) => m.pronoun?.({ gender }))).toEqual(
			["she", "he", "they", "they"],
		);
		// "e" and a combining acute accent, which NFC writes as the one character é.
		expect(m.cafe?.({ place: "café" })).toBe("the café");
		expect(m.cafe?.({ place: "bar" })).toBe("bar");
	});

	it("throws for a value a :string select without * does not list", async () => {
		const { m } = await project({
			en: { size: onString("size", { "s=s": "small", "s=l": "large" }) },
		}).load();

		expect(m.size?.({ size: "l" })).toBe("large");
		expect(thrown(() => m.size?.({ size: "xl" }))).toMatchObject({
			name: "GraiError",
			code: "value-unmatched",
		});
	});

	it("is an error with an option, which :string does not take, or with two keys NFC writes alike", async () => {
		expect(
			await errorsOf({
				en: {
					placeholder: "Hi {name :string u:dir=rtl}",
					local: [
						{
							declarations: ["input g", "local s = g: string select=exact"],
							selectors: ["s"],
							match: { "s=*": "x" },
						},
					],
					twice: onString("place", {
						"s=café": "a",
						"s=café": "b",
						"s=*": "c",
					}),
				},
			}),
		).toEqual([
			'message-invalid: messages/en.json: "local" (en): "local s = g: string select=exact": :string takes no options.',
			'message-invalid: messages/en.json: "placeholder" (en): {name :string u:dir=rtl}: :string takes no options.',
			'message-invalid: messages/en.json: "twice" (en): the variants s=café and s=cafe\u0301 are one key, as Unicode\'s NFC writes them, so one of them can never be chosen. Remove one.',
		]);
	});
});
