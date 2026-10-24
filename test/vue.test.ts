import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { createSSRApp, defineComponent, h } from "vue";
import { renderToString } from "vue/server-renderer";
import {
	Markup,
	type MarkupElement,
	type MarkupPart,
} from "../src/vue/markup.ts";
import { project, thrown } from "./project.ts";

const markup: Record<string, MarkupElement> = {
	link: (children) => h("a", { href: "/terms" }, children),
	b: (children) => h("b", children),
	br: () => h("br"),
};

/** Vue's markers around a fragment's children in server-rendered HTML, which hydration reads. */
const fragmentMarkers = /<!--\[-->|<!--\]-->/g;

/** The HTML a Vue server render of `Markup` writes for `parts`, its fragment markers left out. */
async function html(
	parts: readonly MarkupPart[],
	elements = markup,
): Promise<string> {
	const app = createSSRApp({
		render: () => h(Markup, { parts, markup: elements }),
	});
	return (await renderToString(app)).replaceAll(fragmentMarkers, "");
}

describe("Markup", () => {
	it("draws a compiled message's elements with the app's functions, in the translators' places", async () => {
		const { m } = await project({
			en: { terms: "Read the {#link}{#b}terms{/b} of {name}{/link}.{#br/}" },
		}).load();
		const parts = m.terms?.parts?.({ name: "Ana's shop" }) ?? [];

		expect(await html(parts)).toBe(
			'Read the <a href="/terms"><b>terms</b> of Ana&#39;s shop</a>.<br>',
		);
	});

	it("gives an element the options and attributes the message writes on its start", async () => {
		const { m } = await project({
			en: {
				terms: "Read the {#link href=|/terms| @rel=nofollow}terms{/link}.",
			},
		}).load();
		const parts = m.terms?.parts?.() ?? [];

		expect(
			await html(parts, {
				link: (children, { options, attributes }) =>
					h("a", { href: String(options.href), rel: attributes.rel }, children),
			}),
		).toBe('Read the <a href="/terms" rel="nofollow">terms</a>.');
	});

	it("closes an end's innermost element of its name, draws a stray end as nothing, and closes what is open at the end", async () => {
		const piece = (type: "markup-start" | "markup-end", name: string) =>
			({ type, name, options: {}, attributes: {} }) satisfies MarkupPart;
		const start = (name: string) => piece("markup-start", name);
		const end = (name: string) => piece("markup-end", name);
		const text = (value: string): MarkupPart => ({ type: "text", value });

		expect(
			await html([
				start("link"),
				start("b"),
				text("a"),
				end("link"),
				text("b"),
			]),
		).toBe('<a href="/terms"><b>a</b></a>b');
		expect(await html([text("a"), end("b"), start("b"), text("c")])).toBe(
			"a<b>c</b>",
		);
	});

	it("throws for an element the app does not draw, naming it", () => {
		// Parts that do not type their elements, as before a message names them in its type.
		const parts: MarkupPart[] = [
			{ type: "markup-standalone", name: "icon", options: {}, attributes: {} },
		];

		expect(thrown(() => Markup({ parts, markup }))).toMatchObject({
			message:
				'Markup has no function for the message\'s element "icon". Add icon to its markup.',
		});
	});

	it("throws for an element named as a member every object inherits, which the app's functions do not hold", () => {
		const standalone = (name: string): MarkupPart => ({
			type: "markup-standalone",
			name,
			options: {},
			attributes: {},
		});

		for (const name of ["constructor", "toString"]) {
			expect(
				thrown(() => Markup({ parts: [standalone(name)], markup })),
			).toMatchObject({
				message: `Markup has no function for the message's element "${name}". Add ${name} to its markup.`,
			});
		}
	});
});

describe("a Vue server render through the output's middleware", () => {
	it("renders interleaved requests each in its own locale, before and after a component awaits", async () => {
		const { dir, load } = project(
			{
				en: { greeting: "Hello", cart: "{count} in your cart" },
				ro: { greeting: "Bună ziua", cart: "{count} în coș" },
			},
			{ strategy: ["cookie"], cookieName: "lang" },
		);
		const { m } = await load();
		const { middleware } = await import(
			pathToFileURL(join(dir, "out", "server.js")).href
		);
		/** Each render's turn to go on after its await, released once every render waits. */
		const turns: (() => void)[] = [];
		const Page = defineComponent({
			async setup() {
				const before = m.greeting?.();
				await new Promise<void>((resolve) => turns.push(resolve));
				return () => h("p", `${before} / ${m.cart?.({ count: 2 })}`);
			},
		});
		const render = (locale: string): Promise<string> =>
			middleware(
				new Request("https://shop.test/", {
					headers: { cookie: `lang=${locale}` },
				}),
				async () => new Response(await renderToString(createSSRApp(Page))),
			).then((response: Response) => response.text());
		const locales = Array.from({ length: 24 }, (_, index) =>
			index % 2 === 0 ? "en" : "ro",
		);

		const pages = Promise.all(locales.map(render));
		await expect.poll(() => turns.length).toBe(locales.length);
		for (const goOn of turns.toReversed()) goOn();

		expect(await pages).toEqual(
			locales.map((locale) =>
				locale === "en"
					? "<p>Hello / 2 in your cart</p>"
					: "<p>Bună ziua / 2 în coș</p>",
			),
		);
	});
});
