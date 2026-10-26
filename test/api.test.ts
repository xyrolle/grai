import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { importableNames } from "./language-server.ts";
import { project } from "./project.ts";

// The public API, as docs/api.md lists it: what a module's JavaScript exports, and what an editor
// offers to import from its declarations, types included. A name added to either is a decision.

const catalogs = {
	en: { cart_title: "Your cart", cart_items: "{count} items" },
	de: { cart_title: "Ihr Warenkorb", cart_items: "{count} Artikel" },
};

it("exports from the output's runtime.js only the API apps call", async () => {
	const { dir, load } = project(catalogs);
	const { runtime } = await load();

	expect(Object.keys(runtime).sort()).toEqual([
		"GraiError",
		"assertIsLocale",
		"baseLocale",
		"deLocalizeUrl",
		"extractLocaleFromUrl",
		"getLocale",
		"getTextDirection",
		"isLocale",
		"locales",
		"localizeHref",
		"localizeUrl",
		"setLocale",
	]);
	expect(await importableNames(dir, "./out/runtime.js")).toEqual([
		"GraiError",
		"Locale",
		"MarkupMessage",
		"Message",
		"MessagePart",
		"assertIsLocale",
		"baseLocale",
		"deLocalizeUrl",
		"extractLocaleFromUrl",
		"getLocale",
		"getTextDirection",
		"isLocale",
		"locales",
		"localizeHref",
		"localizeUrl",
		"setLocale",
	]);
});

it("exports the middleware, its lookup, redirect and Vary, defineServerStrategy, withLocale and localeCopies from server.js, useLocale from testing.js, m from messages.js and each key from keys.js", async () => {
	const { dir, compile } = project(catalogs);
	await compile();
	const output = (file: string) =>
		import(pathToFileURL(join(dir, "out", file)).href);

	expect(Object.keys(await output("server.js")).sort()).toEqual([
		"defineServerStrategy",
		"localeCopies",
		"localeOf",
		"middleware",
		"redirectOf",
		"vary",
		"withLocale",
	]);
	expect(Object.keys(await output("testing.js"))).toEqual(["useLocale"]);
	expect(Object.keys(await output("messages.js"))).toEqual(["m"]);
	expect(Object.keys(await output("keys.js")).sort()).toEqual([
		"cart_items",
		"cart_title",
	]);
	expect(await importableNames(dir, "./out/server.js")).toEqual([
		"defineServerStrategy",
		"localeCopies",
		"localeOf",
		"middleware",
		"redirectOf",
		"vary",
		"withLocale",
	]);
	expect(await importableNames(dir, "./out/testing.js")).toEqual(["useLocale"]);
	expect(await importableNames(dir, "./out/messages.js")).toEqual(["m"]);
	expect(await importableNames(dir, "./out/keys.js")).toEqual([
		"cart_items",
		"cart_title",
	]);
});

it("exports from grai, grai/vite and grai/svelte only their API", async () => {
	const { dir } = project(catalogs);

	expect(Object.keys(await import("../src/index.ts")).sort()).toEqual([
		"GraiError",
		"compile",
	]);
	expect(Object.keys(await import("../src/vite.ts")).sort()).toEqual([
		"grai",
		"graiModules",
	]);
	expect(Object.keys(await import("../src/svelte.ts"))).toEqual(["grai"]);
	expect(await importableNames(dir, "grai")).toEqual([
		"CompileResult",
		"GraiError",
		"GraiErrorCode",
		"compile",
	]);
	expect(await importableNames(dir, "grai/vite")).toEqual([
		"GraiModuleKind",
		"grai",
		"graiModules",
	]);
	expect(await importableNames(dir, "grai/svelte")).toEqual(["grai"]);
});

it("exports from grai/sveltekit, grai/sveltekit/vite, grai/sveltekit/navigation, grai/next, grai/next/config, grai/next/proxy and grai/react only their API", async () => {
	const { dir } = project(catalogs);

	expect(Object.keys(await import("../src/sveltekit.ts"))).toEqual([
		"handleLocale",
	]);
	expect(await importableNames(dir, "grai/sveltekit")).toEqual([
		"handleLocale",
	]);
	expect(Object.keys(await import("../src/sveltekit-vite.ts"))).toEqual([
		"grai",
	]);
	expect(await importableNames(dir, "grai/sveltekit/vite")).toEqual([
		"SvelteKitGraiOptions",
		"grai",
	]);
	expect(await importableNames(dir, "grai/sveltekit/navigation")).toEqual([
		"PageUrls",
		"reloadAcrossLocales",
	]);

	expect(Object.keys(await import("../src/next/config.ts"))).toEqual([
		"withGrai",
	]);
	expect(Object.keys(await import("../src/react/markup.ts"))).toEqual([
		"Markup",
	]);
	expect(await importableNames(dir, "grai/next")).toEqual([
		"LocaleProvider",
		"bindLocale",
	]);
	expect(await importableNames(dir, "grai/next/config")).toEqual([
		"WithGraiOptions",
		"withGrai",
	]);
	expect(await importableNames(dir, "grai/next/proxy")).toEqual(["proxy"]);
	expect(await importableNames(dir, "grai/react")).toEqual(["Markup"]);
});

it("exports from grai/astro and grai/astro/middleware only their API", async () => {
	const { dir } = project(catalogs);

	expect(Object.keys(await import("../src/astro.ts"))).toEqual(["grai"]);
	expect(await importableNames(dir, "grai/astro")).toEqual([
		"GraiAstroOptions",
		"grai",
	]);
	expect(Object.keys(await import("../src/astro/middleware.ts"))).toEqual([
		"localeMiddleware",
	]);
	expect(await importableNames(dir, "grai/astro/middleware")).toEqual([
		"LocaleContext",
		"LocaleProject",
		"localeMiddleware",
	]);
});
