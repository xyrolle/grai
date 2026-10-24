import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { compile } from "../src/index.ts";
import { errorsOf, project } from "./project.ts";

const counted = (match: Record<string, string>) => [
	{
		declarations: ["input count", "local countPlural = count: plural"],
		selectors: ["countPlural"],
		match,
	},
];

describe("the config", () => {
	it("is an error when there is none", async () => {
		const { dir } = project({ en: { title: "Title" } });
		const result = await compile(join(dir, "missing.json"));

		expect(result.errors.map((error) => error.code)).toEqual([
			"config-missing",
		]);
		expect(result.errors[0]?.message).toContain(
			`there is no config file at ${join(dir, "missing.json")}`,
		);
	});

	it("is an error when it cannot be read", async () => {
		const { dir } = project({ en: { title: "Title" } });
		mkdirSync(join(dir, "folder.json"));
		const result = await compile(join(dir, "folder.json"));

		expect(result.errors.map((error) => error.code)).toEqual([
			"config-unreadable",
		]);
	});

	it("is an error when it is not JSON", async () => {
		const { config } = project({ en: { title: "Title" } });
		writeFileSync(config, "{ locales: [en] }");
		const result = await compile(config);

		expect(result.errors.map((error) => error.code)).toEqual([
			"config-invalid",
		]);
		expect(result.errors[0]?.message).toMatch(
			/^grai\.config\.json: the config file is not JSON: /,
		);
	});

	it("names a field it does not know, and a field with a wrong value", async () => {
		expect(
			await errorsOf({ en: { title: "Title" } }, { outDir: "out" }),
		).toEqual([
			'config-invalid: grai.config.json: "outDir" is not a config field; the fields are locales, baseLocale, catalogs, outdir, strategy, cookieName, switch.',
		]);
		expect(
			await errorsOf({ en: { title: "Title" } }, { baseLocale: "de" }),
		).toEqual([
			'config-invalid: grai.config.json: "baseLocale" must be one of "locales": en.',
		]);
		expect(
			await errorsOf({ en: { title: "Title" } }, { locales: ["en", "en"] }),
		).toEqual([
			'config-invalid: grai.config.json: "locales" must be a non-empty list of distinct BCP 47 language tags, such as ["en", "de"].',
		]);
	});
	it("names a strategy it does not know, and a cookie strategy without its cookie", async () => {
		const catalogs = { en: { title: "Title" } };

		expect(await errorsOf(catalogs, { strategy: ["header"] })).toEqual([
			'config-invalid: grai.config.json: "strategy" must list where a request names its locale, each once: "cookie", "preferredLanguage" or "url".',
		]);
		expect(await errorsOf(catalogs, { strategy: ["cookie"] })).toEqual([
			'config-invalid: grai.config.json: "cookieName" must name the cookie the "cookie" strategy reads.',
		]);
		expect(await errorsOf(catalogs, { cookieName: "lang" })).toEqual([
			'config-invalid: grai.config.json: "cookieName" is read only by the "cookie" strategy, which "strategy" does not list.',
		]);
	});

	it("names a locale switch it does not know", async () => {
		expect(
			await errorsOf({ en: { title: "Title" } }, { switch: "instant" }),
		).toEqual([
			'config-invalid: grai.config.json: "switch" must be "reload", where a page changes locale by reloading, or "live", where it changes in place.',
		]);
	});
});

describe("a catalog", () => {
	it("is an error, naming its locale's file, when it is missing", async () => {
		const { dir, compile } = project({
			en: { title: "Title" },
			de: { title: "Titel" },
		});
		rmSync(join(dir, "messages", "de.json"));
		const result = await compile();

		expect(
			result.errors.map((error) => [error.code, error.file, error.locale]),
		).toEqual([["catalog-missing", "messages/de.json", "de"]]);
	});

	it("is an error when it cannot be read", async () => {
		const { dir, compile } = project({ en: { title: "Title" } });
		rmSync(join(dir, "messages", "en.json"));
		mkdirSync(join(dir, "messages", "en.json"));

		expect((await compile()).errors.map((error) => error.code)).toEqual([
			"catalog-unreadable",
		]);
	});

	it("is an error when it is not a JSON object", async () => {
		const { dir, compile } = project({
			en: { title: "Title" },
			de: { title: "Titel" },
		});
		writeFileSync(join(dir, "messages", "de.json"), '{ "title": "Titel", }');
		writeFileSync(join(dir, "messages", "en.json"), '["Title"]');

		expect(
			(await compile()).errors.map((error) => [error.code, error.file]),
		).toEqual([
			["catalog-invalid", "messages/de.json"],
			["catalog-invalid", "messages/en.json"],
		]);
	});

	it("is an error when it holds no messages, so a locale never renders empty", async () => {
		expect(
			await errorsOf({
				en: { title: "Title" },
				de: { $schema: "https://inlang.com/schema/inlang-message-format" },
			}),
		).toEqual([
			'catalog-empty: messages/de.json: the catalog has no messages, so de would render nothing. Add its messages, or remove de from "locales".',
		]);
	});
});

describe("a key", () => {
	it("is an error when a locale lacks it", async () => {
		expect(
			await errorsOf({
				en: { title: "Title", extra: "Extra" },
				de: { title: "Titel" },
			}),
		).toEqual([
			'key-missing: messages/de.json: "extra" (de): the key is in en but not in de. Add it to every catalog, or remove it from all.',
		]);
	});

	it("is an error when it is no identifier, or differs from another only in case", async () => {
		expect(
			await errorsOf({
				en: { "nav.home": "Home", title: "Title", Title: "Title" },
			}),
		).toEqual([
			'key-invalid: messages/en.json: "Title": the key differs from "title" only in case, which a case-insensitive file system cannot tell apart. Rename one.',
			'key-invalid: messages/en.json: "nav.home": a key must be a JavaScript identifier and not a reserved word, as it is the message\'s export name. Use letters, digits, _ and $.',
			'key-invalid: messages/en.json: "title": the key differs from "Title" only in case, which a case-insensitive file system cannot tell apart. Rename one.',
		]);
	});
});

describe("a message", () => {
	it("is an error when a placeholder is no name", async () => {
		expect(await errorsOf({ en: { title: "Hello { name }" } })).toEqual([
			'message-invalid: messages/en.json: "title" (en): { name } is not a placeholder: a placeholder is a name such as {count}. Write a literal brace as \\{.',
		]);
	});

	it("is an error when it uses what grai does not support yet", async () => {
		expect(
			await errorsOf({
				en: {
					formatted: "Total {amount :string}",
					link: "Read {#link href=|/terms|}the terms{/link}",
					nested: { title: "Title" },
				},
			}),
		).toEqual([
			'unsupported: messages/en.json: "formatted" (en): {amount :string} calls :string, which grai does not support; the formatting functions are :number, :integer, :percent, :currency, :unit, :relativetime, :list, :datetime, :date, :time.',
			'unsupported: messages/en.json: "link" (en): the markup {#link href=|/terms|} has options or attributes, which grai does not support yet. Write it as {#name}, {/name} or {#name/}.',
			'unsupported: messages/en.json: "nested" (en): the value is an object of nested keys, which grai does not support. Flatten it into keys joined by _.',
		]);
	});

	it("is an error when a declaration or a variant key is malformed", async () => {
		expect(
			await errorsOf({
				en: {
					declared: [
						{
							declarations: ["inptu count"],
							selectors: [],
							match: { "": "x" },
						},
					],
					keyed: counted({ "countPlural=one,other": "x" }),
					ordinal: [
						{
							declarations: ["input n", "local p = n: plural select=ordinal"],
							selectors: ["p"],
							match: { "p=*": "{n}th" },
						},
					],
					unnamed: counted({ "countPlural=one": "one", "": "any" }),
					twice: counted({
						"countPlural=one": "a",
						" countPlural = one ": "b",
						"countPlural=other": "c",
					}),
				},
			}),
		).toEqual([
			'message-invalid: messages/en.json: "declared" (en): "inptu count" is not a declaration. Write "input name", "local namePlural = name: plural" or "local nameText = name: number".',
			'message-invalid: messages/en.json: "keyed" (en): the variant key "countPlural=one,other" must be selector=value pairs joined by commas, such as "countPlural=one".',
			'message-invalid: messages/en.json: "ordinal" (en): "local p = n: plural select=ordinal": plural takes one option, type, which is cardinal (the default) or ordinal, as in "local nOrdinal = n: plural type=ordinal".',
			'message-invalid: messages/en.json: "twice" (en): two variants have the keys one, so one of them can never be chosen. Remove one.',
			'message-invalid: messages/en.json: "unnamed" (en): the variant key "" has no value for the selector "countPlural". Give it one, or * for any.',
		]);
	});

	it("is an error when a variant names a plural or ordinal category its locale does not have", async () => {
		expect(
			await errorsOf({
				en: {
					items: counted({
						"countPlural=one": "a",
						"countPlural=few": "b",
						"countPlural=other": "c",
					}),
				},
				ru: {
					items: [
						{
							declarations: [
								"input count",
								"local countPlural = count: plural type=ordinal",
							],
							selectors: ["countPlural"],
							match: { "countPlural=one": "a", "countPlural=*": "b" },
						},
					],
				},
			}),
		).toEqual([
			'plural-category-unknown: messages/en.json: "items" (en): "few" is not a plural category of en, so the variant countPlural=few can never be chosen. Its categories are one, other.',
			'plural-category-unknown: messages/ru.json: "items" (ru): "one" is not an ordinal category of ru, so the variant countPlural=one can never be chosen. Its categories are other.',
		]);
	});

	it("is an error when a value has no variant", async () => {
		expect(
			await errorsOf({
				en: { items: counted({ "countPlural=one": "a" }) },
				pl: {
					items: counted({
						"countPlural=one": "a",
						"countPlural=few": "b",
						"countPlural=other": "c",
					}),
				},
			}),
		).toEqual([
			'selection-not-exhaustive: messages/en.json: "items" (en): no variant matches countPlural=other. Add one, or a variant with * for the selectors it does not care about.',
			'selection-not-exhaustive: messages/pl.json: "items" (pl): no variant matches countPlural=many. Add one, or a variant with * for the selectors it does not care about.',
		]);
	});
});

it("reports every error of a compile at once, by file, key and locale", async () => {
	const result = await project({
		en: { b: "{ x }", a: "{ y }" },
		de: { b: "{ z }", a: "A" },
	}).compile();

	expect(
		result.errors.map((error) => [error.file, error.key, error.locale]),
	).toEqual([
		["messages/de.json", "b", "de"],
		["messages/en.json", "a", "en"],
		["messages/en.json", "b", "en"],
	]);
	expect(result.written).toEqual([]);
});
