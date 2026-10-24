import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { recompile } from "../src/compile.ts";
import { errorsOf, type Messages, project } from "./project.ts";

const fallbacks = { "en-GB": "en" };
const catalogs = {
	en: { color: "Color", cart: "Cart", greeting: "Hello {name}" },
	"en-GB": { color: "Colour" },
};

it("renders a key a locale lacks in the words of the locale it falls back to", async () => {
	const { m } = await project(catalogs, { fallbacks }).load();

	expect(
		["color", "cart"].map((key) => m[key]?.({}, { locale: "en-GB" })),
	).toEqual(["Colour", "Cart"]);
});

it("compiles a locale whose catalog is empty, all its words its fallback's", async () => {
	const { m } = await project(
		{ en: catalogs.en, "en-GB": {} },
		{ fallbacks },
	).load();

	expect(m.color?.({}, { locale: "en-GB" })).toBe("Color");
});

it("is still an error when neither a locale nor its fallback has a key", async () => {
	const errors = await errorsOf(
		{
			en: { color: "Color" },
			de: { color: "Farbe", cart: "Warenkorb" },
			"en-GB": {},
		},
		{ fallbacks },
	);

	expect(errors.every((error) => error.startsWith("key-missing:"))).toBe(true);
	expect(errors.join("\n")).toMatch(/"cart".* en-GB/);
});

it("names the fallback's file for a problem in a message a locale takes from it", async () => {
	const { compile } = project(
		{ en: { total: "Total {sum :currency}" }, "en-GB": {} },
		{ fallbacks },
	);

	expect(
		(await compile()).errors.map((error) => [error.file, error.locale]),
	).toEqual([
		["messages/en.json", "en"],
		["messages/en.json", "en-GB"],
	]);
});

it("takes an edit of the fallback's message into the locales that fall back to it", async () => {
	const { dir, config } = project(catalogs, { fallbacks });
	const first = await recompile(config, undefined);
	writeFileSync(
		join(dir, "messages", "en.json"),
		JSON.stringify({ ...catalogs.en, cart: "Basket" }, null, "\t"),
	);
	await recompile(config, first.build);
	const { m }: { m: Messages } = await import(
		`${pathToFileURL(join(dir, "out", "messages.js")).href}?edited`
	);

	expect(m.cart?.({}, { locale: "en-GB" })).toBe("Basket");
});

it("compiles again when a locale's fallback changes, from scratch and in watch", async () => {
	const fallingBack = (to: string) =>
		JSON.stringify({
			locales: ["en", "en-GB", "en-AU"],
			baseLocale: "en",
			catalogs: "messages/{locale}.json",
			outdir: "out",
			fallbacks: { "en-GB": "en", "en-AU": to },
		});
	const { dir, config, compile } = project({
		en: { color: "Color" },
		"en-GB": { color: "Colour" },
		"en-AU": {},
	});
	/** How many locales the shard writes "Colour" for: en-GB, and en-AU when it falls back to it. */
	const colours = () =>
		readFileSync(join(dir, "out", "keys", "0.js"), "utf8").split('"Colour"')
			.length - 1;
	writeFileSync(config, fallingBack("en-GB"));
	const first = await recompile(config, undefined);
	const before = colours();
	writeFileSync(config, fallingBack("en"));
	await recompile(config, first.build);
	const watched = colours();
	writeFileSync(config, fallingBack("en-GB"));
	await compile();

	expect([before, watched, colours()]).toEqual([2, 1, 2]);
});
