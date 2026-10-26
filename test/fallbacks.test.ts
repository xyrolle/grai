import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { add } from "../src/add.ts";
import { check } from "../src/check.ts";
import { recompile } from "../src/compile.ts";
import { removeUnusedKeys } from "../src/fix.ts";
import { importCatalogs } from "../src/import.ts";
import { seed } from "../src/seed.ts";
import { exportLocale, mergeDocument } from "../src/translations.ts";

import { errorsOf, type Messages, outputFile, project } from "./project.ts";

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
	const colours = async () =>
		readFileSync(await outputFile(dir, "keys/0.js"), "utf8").split('"Colour"')
			.length - 1;
	writeFileSync(config, fallingBack("en-GB"));
	const first = await recompile(config, undefined);
	const before = await colours();
	writeFileSync(config, fallingBack("en"));
	await recompile(config, first.build);
	const watched = await colours();
	writeFileSync(config, fallingBack("en-GB"));
	await compile();

	expect([before, watched, await colours()]).toEqual([2, 1, 2]);
});

it("adds a key without a text for a locale that falls back", async () => {
	const { dir, config } = project(catalogs, { fallbacks });
	const result = await add(config, "total", { en: "Total" });

	expect(result.errors).toEqual([]);
	expect(readFileSync(join(dir, "messages", "en-GB.json"), "utf8")).toBe(
		JSON.stringify(catalogs["en-GB"], null, "\t"),
	);
});

it("adds a key a locale takes from its fallback only as that locale's own text", async () => {
	const { dir, config } = project(catalogs, { fallbacks });
	const nothing = await add(config, "cart", {});
	const own = await add(config, "cart", { "en-GB": "Basket" });

	expect(nothing.errors.map((error) => error.message)).toEqual([
		'messages/en.json: "cart": the key is already in the catalogs, and en-GB takes it from a fallback. Edit its messages there, or give a locale its own text.',
	]);
	expect(own.errors).toEqual([]);
	expect(
		JSON.parse(readFileSync(join(dir, "messages", "en-GB.json"), "utf8")),
	).toEqual({ color: "Colour", cart: "Basket" });
});

it("checks the inputs of a key some locales take from their fallback", async () => {
	const { config } = project(
		{
			en: { greeting: "Hello {name}" },
			"en-GB": {},
			de: { greeting: "Hallo" },
		},
		{ fallbacks },
	);

	expect((await check(config)).problems.map((error) => error.code)).toContain(
		"inputs-differ",
	);
});

it("leaves check --fix nothing to refuse in a locale whose empty catalog takes its fallback's words", async () => {
	const { dir, config } = project(
		{ en: { color: "Color" }, "en-GB": {} },
		{ fallbacks },
	);
	writeFileSync(
		join(dir, "app.ts"),
		'import { m } from "./out/messages.js";\nm.color();\n',
	);

	const fixed = await removeUnusedKeys(config);

	expect([fixed.removed, fixed.errors]).toEqual([[], []]);
});

it("exports a key a locale takes from its fallback as translated, in its fallback's words", async () => {
	const { config, dir } = project(catalogs, { fallbacks });
	const exported = async (untranslated: boolean) => {
		const result = await exportLocale(config, "en-GB", {
			json: true,
			untranslated,
		});
		if ("errors" in result) throw new Error(result.errors[0]?.message);
		return result.document;
	};
	const targets = (document: string) =>
		JSON.parse(document).units.map(
			(unit: { key: string; target?: string }) => `${unit.key}: ${unit.target}`,
		);
	const all = await exported(false);

	expect(targets(await exported(true))).toEqual([]);
	expect(targets(all)).toEqual([
		"color: Colour",
		"cart: Cart",
		"greeting: Hello {name}",
	]);
	const file = join(dir, "en-GB.json");
	writeFileSync(file, all);
	expect(await mergeDocument(config, file)).toMatchObject({ messages: 0 });
	expect(
		JSON.parse(readFileSync(join(dir, "messages", "en-GB.json"), "utf8")),
	).toEqual(catalogs["en-GB"]);
});

it("seeds a locale with no key its fallback has, so it keeps taking them from there", async () => {
	const { config, dir } = project(catalogs, { fallbacks });

	expect(await seed(config, "en-GB")).toMatchObject({ keys: 0 });
	expect(
		JSON.parse(readFileSync(join(dir, "messages", "en-GB.json"), "utf8")),
	).toEqual(catalogs["en-GB"]);
});

it("imports a key a locale's source lacks from its fallback's, keeping the locale's catalog sparse", () => {
	const { config, dir } = project(catalogs, { fallbacks });
	const sources = join(dir, "source");
	mkdirSync(sources);
	writeFileSync(
		join(sources, "en.json"),
		JSON.stringify({ color: "Color", cart: "Cart" }),
	);
	writeFileSync(
		join(sources, "en-GB.json"),
		JSON.stringify({ color: "Colour" }),
	);
	rmSync(join(dir, "messages"), { recursive: true });

	const result = importCatalogs(config, "i18next", [sources]);

	expect(result.leftOut).toEqual([]);
	expect(
		JSON.parse(readFileSync(join(dir, "messages", "en-GB.json"), "utf8")),
	).toEqual({
		$schema: "https://inlang.com/schema/inlang-message-format",
		color: "Colour",
	});
});
