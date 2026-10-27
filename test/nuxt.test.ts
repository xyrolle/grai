import { fileURLToPath } from "node:url";
import { loadNuxt } from "nuxt/kit";
import type { NuxtPage } from "nuxt/schema";
import { describe, expect, it } from "vitest";
import module from "../src/nuxt/module.ts";
import { localizedPages, sharedPath } from "../src/nuxt/pages.ts";
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
			"grai: @xyrolle/grai/nuxt renders each page in its request's locale on the server, and Nuxt's ssr is off. Turn it on.",
		);
	});

	it("routes pathnames beside domains, and refuses a path that two locales' words give two pages", async () => {
		/** The pages Nuxt routes, after the module adds its own to a project's. */
		const routed = async (pathnames: Record<string, unknown>) => {
			const nuxt = await loadNuxt({
				cwd: fileURLToPath(new URL("..", import.meta.url)),
				overrides: {
					rootDir: project(
						{ en: { title: "Your cart" }, ro: { title: "Coșul tău" } },
						{
							strategy: ["url"],
							domains: { en: "shop.test", ro: "shop.ro.test" },
							pathnames,
						},
					).dir,
					modules: [module],
					telemetry: false,
				},
			});
			const pages: NuxtPage[] = [
				{ name: "about", path: "/about", file: "about.vue" },
				{ name: "contact", path: "/contact", file: "contact.vue" },
			];
			try {
				await nuxt.callHook("pages:resolved", pages);
				return pages;
			} finally {
				await nuxt.close();
			}
		};

		expect(await routed({ "/about": { ro: "/despre" } })).toContainEqual({
			name: "about___ro",
			path: "/ro/despre",
			alias: ["/despre"],
			file: "about.vue",
		});
		await expect(
			routed({ "/about": { ro: "/despre" }, "/contact": { ro: "/about" } }),
		).rejects.toThrow(
			`grai.config.json: Nuxt routes a page by its path alone, the same on every host, and "pathnames" gives /about to contact.vue in ro, where it is about.vue's path too. Give one of them other words.`,
		);
	});

	it("refuses a base URL that is not grai's basePath, under the url strategy, which reads the locale after it", async () => {
		await expect(
			loaded({ strategy: ["url"] }, { app: { baseURL: "/shop/" } }),
		).rejects.toThrow(
			`grai.config.json: Nuxt's app.baseURL "/shop/" and grai's "basePath" (none) must name the same path: the "url" strategy reads the locale after it.`,
		);
		await expect(
			loaded(
				{ strategy: ["url"], basePath: "/shop" },
				{ app: { baseURL: "/shop/" } },
			),
		).resolves.toBeUndefined();
	});
});

describe("the pages of the url strategy", () => {
	const asNeeded = {
		localePrefix: "as-needed",
		prefixes: ["en", "ro"],
		unlocalizedPaths: [],
		pathnames: [],
		basePath: "",
		domains: [],
	} as const;
	const index: NuxtPage = { name: "index", path: "/", file: "index.vue" };
	const docs: NuxtPage = {
		name: "docs",
		path: "/docs/:page()",
		file: "docs.vue",
	};

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

		expect(localizedPages(pages, ["en", "ro"], "en", asNeeded)).toEqual([
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

	it("routes a locale under its own prefix, as localePrefixes names it", () => {
		const routing = { ...asNeeded, prefixes: ["en", "romana"] };

		expect(localizedPages([index], ["en", "ro"], "en", routing)).toEqual([
			{ name: "index___ro", path: "/romana", file: "index.vue" },
		]);
	});

	it("routes every page under the base locale's prefix too when every locale's paths are prefixed", () => {
		const routing = { ...asNeeded, localePrefix: "always" } as const;

		expect(localizedPages([index], ["en", "ro"], "en", routing)).toEqual([
			{ name: "index___en", path: "/en", file: "index.vue" },
			{ name: "index___ro", path: "/ro", file: "index.vue" },
		]);
	});

	it("routes a page in each locale's words where pathnames give them, its segments kept", () => {
		const product: NuxtPage = {
			name: "products-id",
			path: "/products/:id()",
			file: "products/[id].vue",
		};
		const routing = {
			...asNeeded,
			pathnames: [
				{
					route: "/products/[id]",
					paths: ["/goods/[id]", "/produse/[id]"],
				},
				{ route: "/about", paths: ["/about", "/%C8%99tiri"] },
			],
		};

		expect(
			localizedPages([index, product], ["en", "ro"], "en", routing),
		).toEqual([
			{
				name: "products-id___en",
				path: "/goods/:id()",
				file: "products/[id].vue",
			},
			{ name: "index___ro", path: "/ro", file: "index.vue" },
			{
				name: "products-id___ro",
				path: "/ro/produse/:id()",
				file: "products/[id].vue",
			},
		]);
		expect(
			localizedPages(
				[{ name: "about", path: "/about", file: "about.vue" }],
				["en", "ro"],
				"en",
				routing,
			),
		).toEqual([{ name: "about___ro", path: "/ro/știri", file: "about.vue" }]);
	});

	it("routes a page in a locale's words without its prefix too where domains give the locale a host, on which its paths have none", () => {
		const about: NuxtPage = {
			name: "about",
			path: "/about",
			file: "about.vue",
			children: [{ name: "about-team", path: "/team", file: "team.vue" }],
		};
		const routing = {
			...asNeeded,
			domains: ["shop.test", "shop.ro.test"],
			pathnames: [
				{ route: "/about", paths: ["/about-us", "/despre"] },
				{ route: "/team", paths: ["/team", "/echipa"] },
			],
		};

		expect(localizedPages([index, about], ["en", "ro"], "en", routing)).toEqual(
			[
				{
					name: "about___en",
					path: "/about-us",
					file: "about.vue",
					children: [
						{ name: "about-team___en", path: "/team", file: "team.vue" },
					],
				},
				{ name: "index___ro", path: "/ro", file: "index.vue" },
				{
					name: "about___ro",
					path: "/ro/despre",
					alias: ["/despre"],
					file: "about.vue",
					children: [
						{
							name: "about-team___ro",
							path: "/ro/echipa",
							alias: ["/echipa"],
							file: "team.vue",
						},
					],
				},
			],
		);
		expect(
			localizedPages([about], ["en", "ro"], "en", {
				...routing,
				localePrefix: "always",
			})[0],
		).toEqual({
			name: "about___en",
			path: "/en/about-us",
			alias: ["/about-us"],
			file: "about.vue",
			children: [
				{ name: "about-team___en", path: "/en/team", file: "team.vue" },
			],
		});
	});

	it("finds a path without a prefix that two locales' words give two pages, of a shape Nuxt routes to one", () => {
		const products: NuxtPage = {
			name: "products-id",
			path: "/products/:id()",
			file: "products/[id].vue",
		};
		const posts: NuxtPage = {
			name: "posts-slug",
			path: "/posts/:slug()",
			file: "posts/[slug].vue",
		};
		const routing = {
			...asNeeded,
			domains: ["shop.test", "shop.ro.test"],
			pathnames: [
				{ route: "/products/[id]", paths: ["/products/[id]", "/p/[id]"] },
				{ route: "/posts/[slug]", paths: ["/p/[slug]", "/posts/[slug]"] },
			],
		};

		expect(sharedPath([products, posts], ["en", "ro"], "en", routing)).toEqual({
			path: "/p/:id()",
			locale: "ro",
			pages: ["posts/[slug].vue", "products/[id].vue"],
		});
		// Without domains, ro's words have its prefix wherever they are read.
		expect(
			sharedPath([products, posts], ["en", "ro"], "en", {
				...routing,
				domains: [],
			}),
		).toBeUndefined();
		// Two locales' words for one page lead to that page alone.
		expect(
			sharedPath([products], ["en", "ro"], "en", {
				...routing,
				pathnames: [{ route: "/products/[id]", paths: ["/p/[id]", "/p/[id]"] }],
			}),
		).toBeUndefined();
	});

	it("leaves a page at a path the strategy leaves alone without copies", () => {
		const routing = { ...asNeeded, unlocalizedPaths: ["/docs/**"] };

		expect(localizedPages([index, docs], ["en", "ro"], "en", routing)).toEqual([
			{ name: "index___ro", path: "/ro", file: "index.vue" },
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
