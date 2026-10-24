import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markup, type MarkupPart } from "../src/react/markup.ts";
import { project, thrown } from "./project.ts";

const markup = {
	link: (children?: ReactNode) =>
		createElement("a", { href: "/terms" }, children),
	b: (children?: ReactNode) => createElement("b", null, children),
	br: () => createElement("br"),
};
const html = (parts: readonly MarkupPart[]) =>
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
		const start = (name: string): MarkupPart => ({
			type: "markup-start",
			name,
		});
		const end = (name: string): MarkupPart => ({ type: "markup-end", name });
		const text = (value: string): MarkupPart => ({ type: "text", value });

		expect(
			html([start("link"), start("b"), text("a"), end("link"), text("b")]),
		).toBe('<a href="/terms"><b>a</b></a>b');
		expect(html([text("a"), end("b"), start("b"), text("c")])).toBe(
			"a<b>c</b>",
		);
	});

	it("throws for an element the app does not draw, naming it", () => {
		expect(
			thrown(() => html([{ type: "markup-standalone", name: "icon" }])),
		).toMatchObject({
			message:
				'Markup has no function for the message\'s element "icon". Add icon to its markup.',
		});
	});
});
