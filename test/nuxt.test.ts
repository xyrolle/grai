import { fileURLToPath } from "node:url";
import { loadNuxt } from "nuxt/kit";
import type { NuxtPage } from "nuxt/schema";
import { describe, expect, it } from "vitest";
import module from "../src/nuxt/module.ts";
import { localizedPages } from "../src/nuxt/pages.ts";
import {
	type HeadTag,
	pointAtLocaleChunks,
} from "../src/nuxt/runtime/locale-chunks.ts";
import { project } from "./project.ts";

describe("the module", { timeout: 30_000 }, () => {
	/** Loads Nuxt, from this repository's install, on a project of grai's with the module. */
	const loaded = (
		config: Record<string, unknown>,
		overrides: Record<string, unknown>,
	) =>
		loadNuxt({
			cwd: fileURLToPath(new URL("..", import.meta.url)),
			overrides: {
				rootDir: project({ en: { title: "Your cart" } }, config).dir,
				modules: [module],
				telemetry: false,
				...overrides,
			},
		}).then((nuxt) => nuxt.close());

	it("refuses an app that Nuxt does not render on the server", async () => {
		await expect(loaded({}, { ssr: false })).rejects.toThrow(
			"grai: grai/nuxt renders each page in its request's locale on the server, and Nuxt's ssr is off. Turn it on.",
		);
	});

	it("refuses the url strategy under a base URL, whose segment it would read as the locale", async () => {
		await expect(
			loaded({ strategy: ["url"] }, { app: { baseURL: "/shop/" } }),
		).rejects.toThrow(
			"grai: the url strategy reads a locale from a path's first segment, and Nuxt's app.baseURL is /shop/. Serve the app from /, or use another strategy.",
		);
	});
});

describe("the pages of the url strategy", () => {
	it("routes every page under each locale's prefix but the base locale's, its children's absolute paths too", () => {
		const pages: NuxtPage[] = [
			{ name: "index", path: "/", file: "index.vue" },
			{ name: "about", path: "/about", alias: "/us", file: "about.vue" },
			{
				name: "account",
				path: "/account",
				file: "account.vue",
				children: [
					{ name: "account-orders", path: "orders", file: "orders.vue" },
					{ name: "account-help", path: "/help", file: "help.vue" },
				],
			},
		];

		expect(localizedPages(pages, ["en", "ro"], "en")).toEqual([
			{ name: "index___ro", path: "/ro", file: "index.vue" },
			{
				name: "about___ro",
				path: "/ro/about",
				alias: ["/ro/us"],
				file: "about.vue",
			},
			{
				name: "account___ro",
				path: "/ro/account",
				file: "account.vue",
				children: [
					{ name: "account-orders___ro", path: "orders", file: "orders.vue" },
					{ name: "account-help___ro", path: "/ro/help", file: "help.vue" },
				],
			},
		]);
	});
});

describe("a page's locale's message chunks", () => {
	const importMap = (imports: Record<string, string>): HeadTag => ({
		tag: "script",
		props: { type: "importmap" },
		innerHTML: JSON.stringify({ imports }),
	});
	const link = (rel: string, href: string): HeadTag => ({
		tag: "link",
		props: { rel, href },
	});

	it("maps the shared chunks to the locale's copies in Nuxt's import map, and preloads the copies", () => {
		const tags = [
			importMap({ "#entry": "/_nuxt/Bx1.js" }),
			link("modulepreload", "/_nuxt/grai/a.js"),
			link("prefetch", "/_nuxt/grai/b.js"),
			link("modulepreload", "/_nuxt/c.js"),
		];

		pointAtLocaleChunks(tags, "ro");

		expect(JSON.parse(tags[0]?.innerHTML ?? "")).toEqual({
			imports: { "#entry": "/_nuxt/Bx1.js", "/_nuxt/grai/": "/_nuxt/grai-ro/" },
		});
		expect(tags.slice(1).map(({ props }) => props.href)).toEqual([
			"/_nuxt/grai-ro/a.js",
			"/_nuxt/grai-ro/b.js",
			"/_nuxt/c.js",
		]);
	});

	it("leaves a page without Nuxt's import map as it is, which loads every locale's words", () => {
		const tags = [link("modulepreload", "/_nuxt/grai/a.js")];

		pointAtLocaleChunks(tags, "ro");

		expect(tags).toEqual([link("modulepreload", "/_nuxt/grai/a.js")]);
	});
});
