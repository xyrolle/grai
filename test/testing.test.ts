/// <reference lib="dom" />
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { JSDOM } from "jsdom";
import { aroundEach, describe, expect, it, onTestFinished } from "vitest";
import { type Messages, project } from "./project.ts";

/**
 * A page in jsdom, as an app's component tests have one, its `<html lang>` empty: the output loaded
 * after it renders in the base locale, as a page the server drew in it.
 */
function jsdomPage(): Document {
	const { window } = new JSDOM("<!doctype html><html><body></body></html>");
	globalThis.document = window.document;
	onTestFinished(() => {
		Reflect.deleteProperty(globalThis, "document");
		window.close();
	});
	return window.document;
}

/** A component as an app writes one: it draws a message in the locale its props name. */
function title(m: Messages, target: HTMLElement, props: { locale: string }) {
	target.textContent = m.title?.({}, { locale: props.locale }) ?? "";
}

it("renders a component in a locale other than the page's in jsdom, once the test binds it with useLocale", async () => {
	const page = jsdomPage();
	const { dir, load } = project({
		en: { title: "Your cart" },
		de: { title: "Ihr Warenkorb" },
	});
	const { m } = await load();
	const { useLocale } = await import(
		pathToFileURL(join(dir, "out", "testing.js")).href
	);
	const target = page.createElement("main");

	// A page loaded in the base locale refuses another, as a production page does.
	expect(() => title(m, target, { locale: "de" })).toThrow(
		expect.objectContaining({ code: "locale-not-loaded" }),
	);

	useLocale("de");
	title(m, target, { locale: "de" });

	expect(target.textContent).toBe("Ihr Warenkorb");
	expect(m.title?.()).toBe("Ihr Warenkorb");
	expect(page.documentElement.lang).toBe("de");
});

it("binds a test's locale in a process that serves requests too, outside every request", async () => {
	const { dir, load } = project({
		en: { title: "Your cart" },
		de: { title: "Ihr Warenkorb" },
	});
	const { m } = await load();
	const output = (file: string) =>
		import(pathToFileURL(join(dir, "out", file)).href);
	await output("server.js");
	const { useLocale } = await output("testing.js");

	useLocale("de");

	expect(m.title?.()).toBe("Ihr Warenkorb");
});

/** A project in English and German, loaded as a process whose middleware binds requests. */
async function served() {
	const { dir, load } = project({
		en: { title: "Your cart" },
		de: { title: "Ihr Warenkorb" },
	});
	const { m } = await load();
	const output = (file: string) =>
		import(pathToFileURL(join(dir, "out", file)).href);
	return {
		m,
		server: await output("server.js"),
		testing: await output("testing.js"),
	};
}

describe("a test in a process that serves requests, bound with server.js's withLocale around it", () => {
	let m: Messages = {};
	aroundEach(async (test) => {
		const loaded = await served();
		m = loaded.m;
		await loaded.server.withLocale("de", test);
	});

	it("renders in that locale, in its synchronous code and after an await", async () => {
		const first = m.title?.();
		await new Promise((resolve) => setTimeout(resolve));

		expect([first, m.title?.()]).toEqual(["Ihr Warenkorb", "Ihr Warenkorb"]);
	});
});
