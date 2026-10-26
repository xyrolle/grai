import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markup } from "../src/react/markup.ts";
import { project, thrown } from "./project.ts";

const markup = {
	link: (children?: ReactNode) =>
		createElement("a", { href: "/terms" }, children),
	b: (children?: ReactNode) => createElement("b", null, children),
	br: () => createElement("br"),
};
/** Parts as a message's `.parts()` gives them, for a test to build sequences no catalog writes. */
type Part = Parameters<typeof Markup<string>>[0]["parts"][number];

const html = (parts: readonly Part[]) =>
	renderToStaticMarkup(createElement(Markup, { parts, markup }));

describe("Markup", () => {
	it("draws a compiled message's elements with the app's functions, in the translators' places", async () => {
		const { m } = await project({
			en: { terms: "Read the {#link}{#b}terms{/b} of {name}{/link}.{#br/}" },
		}).load();
		const parts = m.terms?.parts?.({ name: "Ana's shop" }) ?? [];

		expect(html(parts)).toBe(
			'Read the <a href="/terms"><b>terms</b> of Ana&#x27;s shop</a>.<br/>',
		);
	});

	it("closes an end's innermost element of its name, draws a stray end as nothing, and closes what is open at the end", () => {
		const markupPart = (type: "markup-start" | "markup-end", name: string) =>
			({ type, name, options: {}, attributes: {} }) satisfies Part;
		const start = (name: string) => markupPart("markup-start", name);
		const end = (name: string) => markupPart("markup-end", name);
		const text = (value: string): Part => ({ type: "text", value });

		expect(
			html([start("link"), start("b"), text("a"), end("link"), text("b")]),
		).toBe('<a href="/terms"><b>a</b></a>b');
		expect(html([text("a"), end("b"), start("b"), text("c")])).toBe(
			"a<b>c</b>",
		);
	});

	it("throws for an element the app does not draw, naming it", () => {
		expect(
			thrown(() =>
				html([
					{
						type: "markup-standalone",
						name: "icon",
						options: {},
						attributes: {},
					},
				]),
			),
		).toMatchObject({
			message:
				'Markup has no function for the message\'s element "icon". Add icon to its markup.',
		});
	});

	it("throws for an element named as a member every object inherits, which the app's functions do not hold", () => {
		const standalone = (name: string): Part => ({
			type: "markup-standalone",
			name,
			options: {},
			attributes: {},
		});

		for (const name of ["constructor", "toString"]) {
			expect(thrown(() => html([standalone(name)]))).toMatchObject({
				message: `Markup has no function for the message's element "${name}". Add ${name} to its markup.`,
			});
		}
	});
});
