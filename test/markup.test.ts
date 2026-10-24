import { describe, expect, it } from "vitest";
import { errorsOf, project } from "./project.ts";

describe("markup with options and attributes", () => {
	it("gives each option's literal or value and each attribute in its parts, and draws nothing", async () => {
		const { m } = await project({
			en: {
				terms:
					"Read {#link href=|/terms of use| target=_blank rel=$rel @translate=no}the terms{/link kind=inline}{#br @hidden/}",
			},
		}).load();

		expect(m.terms?.({ rel: "noopener" })).toBe("Read the terms");
		expect(m.terms?.parts?.({ rel: "noopener" })).toEqual([
			{ type: "text", value: "Read " },
			{
				type: "markup-start",
				name: "link",
				options: { href: "/terms of use", target: "_blank", rel: "noopener" },
				attributes: { translate: "no" },
			},
			{ type: "text", value: "the terms" },
			{
				type: "markup-end",
				name: "link",
				options: { kind: "inline" },
				attributes: {},
			},
			{
				type: "markup-standalone",
				name: "br",
				options: {},
				attributes: { hidden: true },
			},
		]);
	});

	it("reads a quoted value's escapes, and a formatted local as its text", async () => {
		const { m } = await project({
			en: {
				price: [
					{
						declarations: [
							"input amount",
							"local total = amount: number minimumFractionDigits=2",
						],
						selectors: [],
						match: { "": "{#price label=|a \\| b| value=$total/}" },
					},
				],
			},
		}).load();

		expect(m.price?.parts?.({ amount: 5 })).toEqual([
			{
				type: "markup-standalone",
				name: "price",
				options: { label: "a | b", value: "5.00" },
				attributes: {},
			},
		]);
	});

	it("is an error for an option without a value, one given twice, an input as an attribute, or an open quote", async () => {
		expect(
			await errorsOf({
				en: {
					bare: "{#link href}x{/link}",
					twice: "{#link href=a href=b}x{/link}",
					attribute: "{#link @rel=$rel}x{/link}",
					quote: "{#link href=|/terms}x{/link}",
					closed: "x{/link/}",
				},
			}),
		).toEqual([
			'message-invalid: messages/en.json: "attribute" (en): the markup {#link @rel=$rel}: the attribute @rel takes a literal, not an input.',
			'message-invalid: messages/en.json: "bare" (en): the markup {#link href}: the option href needs a value, such as href=|text|.',
			'message-invalid: messages/en.json: "closed" (en): the markup {/link/}: a closing tag cannot also stand alone.',
			'message-invalid: messages/en.json: "quote" (en): the markup {#link href=|/terms}: a quoted value is not closed by |.',
			'message-invalid: messages/en.json: "twice" (en): the markup {#link href=a href=b}: href is given twice.',
		]);
	});
});
