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
		"bindRequests",
		"cookieName",
		"deLocalizeUrl",
		"extractLocaleFromUrl",
		"formatterFor",
		"getLocale",
		"getTextDirection",
		"isLocale",
		"localeOfPath",
		"locales",
		"localizeHref",
		"localizeUrl",
		"markup",
		"message",
		"pageText",
		"setLocale",
		"text",
		"timeUnit",
		"unmatched",
	]);
	expect(await importableNames(dir, "./out/runtime.js")).toEqual([
		"Call",
		"CompiledInputs",
		"GraiError",
		"Locale",
		"MarkupMessage",
		"Message",
		"MessageOptions",
		"MessagePart",
		"RequestLocale",
		"assertIsLocale",
		"baseLocale",
		"bindRequests",
		"cookieName",
		"deLocalizeUrl",
		"extractLocaleFromUrl",
		"formatterFor",
		"getLocale",
		"getTextDirection",
		"isLocale",
		"localeOfPath",
		"locales",
		"localizeHref",
		"localizeUrl",
		"markup",
		"message",
		"pageText",
		"setLocale",
		"text",
		"timeUnit",
		"unmatched",
	]);
});

it("exports the middleware from server.js, m from messages.js and each key from keys.js", async () => {
	const { dir, compile } = project(catalogs);
	await compile();
	const output = (file: string) =>
		import(pathToFileURL(join(dir, "out", file)).href);

	expect(Object.keys(await output("server.js"))).toEqual(["middleware"]);
	expect(Object.keys(await output("messages.js"))).toEqual(["m"]);
	expect(Object.keys(await output("keys.js")).sort()).toEqual([
		"cart_items",
		"cart_title",
	]);
	expect(await importableNames(dir, "./out/server.js")).toEqual(["middleware"]);
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
		"GraiErrorWhere",
		"compile",
	]);
	expect(await importableNames(dir, "grai/vite")).toEqual([
		"GraiModuleKind",
		"GraiOptions",
		"grai",
		"graiModules",
	]);
	expect(await importableNames(dir, "grai/svelte")).toEqual([
		"GraiOptions",
		"grai",
	]);
});
