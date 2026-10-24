import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GraiError, sortErrors } from "../src/error.ts";
import { compile } from "../src/index.ts";
import { errorsOf, project } from "./project.ts";

const counted = (match: Record<string, string>) => [
	{
		declarations: ["input count", "local countPlural = count: plural"],
		selectors: ["countPlural"],
		match,
	},
];

/** A message with these declarations, selecting on these selectors, with one variant of *. */
const selecting = (declarations: string[], selectors: string[]) => [
	{
		declarations,
		selectors,
		match: {
			[[...new Set(selectors)].map((name) => `${name}=*`).join(",")]: "x",
		},
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
			'config-invalid: grai.config.json: "outDir" is not a config field; the fields are locales, baseLocale, catalogs, outdir, strategy, cookieName, switch, localePrefix, localePrefixes, unlocalizedPaths, tests, identicalToBase, fallbacks, pseudoLocale.',
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

	it("names the canonical form of a locale written in another case", async () => {
		expect(
			await errorsOf({ "en-us": { title: "Title" }, de: { title: "Titel" } }),
		).toEqual([
			'config-invalid: grai.config.json: "locales" lists "en-us", whose canonical form is "en-US". Write it so: the page\'s lang, the cookie and the URL are compared with it exactly.',
		]);
	});

	it("is an error when a fallback is not another locale of the same language", async () => {
		const catalogs = {
			en: { title: "Title" },
			"en-GB": { title: "Title" },
			de: { title: "Titel" },
		};
		const fallbackError = async (fallbacks: Record<string, string>) =>
			(await errorsOf(catalogs, { fallbacks }))[0];

		expect(await fallbackError({ "en-AU": "en" })).toBe(
			'config-invalid: grai.config.json: "fallbacks" maps "en-AU" to "en", but each must be one of "locales": en, en-GB, de.',
		);
		expect(await fallbackError({ de: "en" })).toBe(
			'config-invalid: grai.config.json: "fallbacks" maps "de" to "en", another language, whose words de would show. A fallback is a locale of the same language, such as "en-GB" to "en".',
		);
		expect(await fallbackError({ en: "en-GB" })).toBe(
			'config-invalid: grai.config.json: "fallbacks" maps the base locale, en, which takes no fallback: its catalog has every key.',
		);
		expect(await fallbackError({ "en-GB": "en-GB" })).toBe(
			'config-invalid: grai.config.json: "fallbacks" goes round in a circle: "en-GB" → "en-GB". Each chain of fallbacks must end at a locale that has none.',
		);
	});

	it("is an error when the outdir holds the config or a catalog, which grai would write over or hide", async () => {
		const catalogs = { en: { title: "Title" } };

		expect(await errorsOf(catalogs, { outdir: "." })).toEqual([
			'config-invalid: grai.config.json: "outdir" must be a directory of grai\'s own, as all in it is grai\'s output, but "." holds grai.config.json.',
		]);
		expect(await errorsOf(catalogs, { outdir: "messages" })).toEqual([
			'config-invalid: grai.config.json: "outdir" must be a directory of grai\'s own, as all in it is grai\'s output, but "messages" holds messages/en.json.',
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

	it("is an error when the cookie's name is not one a cookie can have", async () => {
		expect(
			await errorsOf(
				{ en: { title: "Title" } },
				{ strategy: ["cookie"], cookieName: "my lang;" },
			),
		).toEqual([
			'config-invalid: grai.config.json: "cookieName" must be a cookie name, as RFC 6265 has it: letters, digits and !#$%&\'*+-.^_`|~, without spaces.',
		]);
	});

	it("takes localePrefix only with the url strategy, and a strategy after url only with every locale prefixed", async () => {
		const catalogs = { en: { title: "Title" } };

		expect(await errorsOf(catalogs, { localePrefix: "always" })).toEqual([
			'config-invalid: grai.config.json: "localePrefix" is read only by the "url" strategy, which "strategy" does not list.',
		]);
		expect(
			await errorsOf(catalogs, { strategy: ["url"], localePrefix: "never" }),
		).toEqual([
			'config-invalid: grai.config.json: "localePrefix" must be "as-needed", where the base locale\'s paths have no prefix, or "always", where every locale\'s have one.',
		]);
		expect(
			await errorsOf(catalogs, {
				strategy: ["url", "preferredLanguage"],
				localePrefix: "always",
			}),
		).toEqual([]);
	});

	it("takes unlocalizedPaths only with the url strategy, as globs of paths", async () => {
		const catalogs = { en: { title: "Title" } };

		expect(await errorsOf(catalogs, { unlocalizedPaths: ["/app/**"] })).toEqual(
			[
				'config-invalid: grai.config.json: "unlocalizedPaths" is read only by the "url" strategy, which "strategy" does not list.',
			],
		);
		expect(
			await errorsOf(catalogs, {
				strategy: ["url"],
				unlocalizedPaths: ["app/**"],
			}),
		).toEqual([
			'config-invalid: grai.config.json: "unlocalizedPaths" must list globs of paths, each starting with /, of *, **, ? and {a,b}, such as ["/api/**"].',
		]);
		expect(
			await errorsOf(catalogs, {
				strategy: ["url", "preferredLanguage"],
				unlocalizedPaths: ["/app/**"],
			}),
		).toEqual([]);
	});

	it("takes localePrefixes only as path segments of the url strategy's locales, each its own", async () => {
		const catalogs = { en: { title: "Title" }, de: { title: "Titel" } };
		const errors = (localePrefixes: unknown) =>
			errorsOf(catalogs, { strategy: ["url"], localePrefixes });

		expect(await errors({ fr: "france" })).toEqual([
			'config-invalid: grai.config.json: "localePrefixes" names "fr", which is not one of "locales": en, de.',
		]);
		expect(await errors({ de: "de/at" })).toEqual([
			'config-invalid: grai.config.json: "localePrefixes" gives de "de/at", but a prefix is one path segment of lowercase letters, digits and hyphens, such as "us".',
		]);
		expect(await errors({ de: "en" })).toEqual([
			'config-invalid: grai.config.json: "localePrefixes" gives de "en", which is en\'s prefix too. Give each locale a prefix of its own.',
		]);
		expect(
			await errorsOf(catalogs, { localePrefixes: { de: "deutsch" } }),
		).toEqual([
			'config-invalid: grai.config.json: "localePrefixes" is read only by the "url" strategy, which "strategy" does not list.',
		]);
	});

	it("is an error when a strategy follows url, which finds a locale in every path", async () => {
		expect(
			await errorsOf(
				{ en: { title: "Title" } },
				{
					strategy: ["url", "cookie", "preferredLanguage"],
					cookieName: "lang",
				},
			),
		).toEqual([
			'config-invalid: grai.config.json: "strategy" lists "cookie", "preferredLanguage" after "url", which never gets to them: a path without a locale prefix is the base locale\'s. Put them before "url", prefix every locale\'s paths with "localePrefix": "always", or name the paths "url" leaves to them in "unlocalizedPaths".',
		]);
	});

	it("names a locale switch it does not know", async () => {
		expect(
			await errorsOf({ en: { title: "Title" } }, { switch: "instant" }),
		).toEqual([
			'config-invalid: grai.config.json: "switch" must be "reload", where a page changes locale by reloading, or "live", where it changes in place.',
		]);
	});

	it("names test globs that are not a list of globs", async () => {
		expect(
			await errorsOf({ en: { title: "Title" } }, { tests: "**/*.test.ts" }),
		).toEqual([
			'config-invalid: grai.config.json: "tests" must list globs of the test files, of *, **, ? and {a,b}, such as ["**/*.test.*"], or be [] when no file is a test.',
		]);
	});

	it("takes identicalToBase only as distinct keys of locales other than the base", async () => {
		const catalogs = { en: { unit_km: "km" }, de: { unit_km: "km" } };
		const errors = (identicalToBase: unknown) =>
			errorsOf(catalogs, { identicalToBase });

		expect(await errors(["unit_km"])).toEqual([
			'config-invalid: grai.config.json: "identicalToBase" must map a locale to its keys whose message rightly reads as the base locale\'s, such as { "de": ["unit_km"] }.',
		]);
		expect(await errors({ fr: ["unit_km"] })).toEqual([
			'config-invalid: grai.config.json: "identicalToBase" names "fr", which is not one of "locales": en, de.',
		]);
		expect(await errors({ en: ["unit_km"] })).toEqual([
			'config-invalid: grai.config.json: "identicalToBase" names the base locale, en, whose messages are the base text itself.',
		]);
		expect(await errors({ de: ["unit_km", "unit_km"] })).toEqual([
			'config-invalid: grai.config.json: "identicalToBase" must give de a list of distinct keys, such as ["unit_km"].',
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
	it("is one error when locales lack it, naming them and the command that adds it to them", async () => {
		expect(
			await errorsOf({
				en: { title: "Title", extra: "Extra" },
				de: { title: "Titel" },
				fr: { title: "Titre" },
			}),
		).toEqual([
			'key-missing: messages/en.json: "extra": the key is in en but not in de, fr. Add it to them with grai add extra --de "…" --fr "…", or remove it from en.',
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
				},
			}),
		).toEqual([
			'unsupported: messages/en.json: "formatted" (en): {amount :string} calls :string, which grai does not support; the formatting functions are :number, :integer, :percent, :currency, :unit, :relativetime, :list, :datetime, :date, :time.',
		]);
	});

	it("is an error when it calls a function or gives an option grai does not have, even one named as what every object has", async () => {
		expect(
			await errorsOf({
				en: {
					called: "{n :constructor}",
					option: "{n :number constructor=1}",
					refused: "{n :unit unit=meter toString=1}",
				},
			}),
		).toEqual([
			'unsupported: messages/en.json: "called" (en): {n :constructor} calls :constructor, which grai does not support; the formatting functions are :number, :integer, :percent, :currency, :unit, :relativetime, :list, :datetime, :date, :time.',
			expect.stringContaining(
				'"option" (en): {n :number constructor=1}: "constructor=1" is not an option of :number, or is given twice. Its options are select, style,',
			),
			expect.stringContaining(
				'"refused" (en): {n :unit unit=meter toString=1}: "toString=1" is not an option of :unit, or is given twice. Its options are unit,',
			),
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

	it("is an error when a selector is no name, or is listed twice", async () => {
		expect(
			await errorsOf({
				en: {
					dashed: selecting(["input a"], ["a-b"]),
					listed: selecting(
						["input count", "local n = count: number"],
						["n", "n"],
					),
				},
			}),
		).toEqual([
			'message-invalid: messages/en.json: "dashed" (en): "a-b" is not a selector: a selector is the name of an input or a local, such as count.',
			'message-invalid: messages/en.json: "listed" (en): "selectors" lists n twice, and a second selector on a value chooses nothing the first does not. List it once.',
		]);
	});

	it("is an error when a name is declared twice", async () => {
		expect(
			await errorsOf({
				en: {
					local: selecting(
						[
							"input count",
							"local n = count: plural",
							"local n = count: plural type=ordinal",
						],
						["n"],
					),
					input: selecting(["input count", "input count"], ["count"]),
				},
			}),
		).toEqual([
			'message-invalid: messages/en.json: "input" (en): count is declared twice, by "input count" and "input count". Declare it once.',
			'message-invalid: messages/en.json: "local" (en): n is declared twice, by "local n = count: plural" and "local n = count: plural type=ordinal". Declare it once.',
		]);
	});

	it("is an error when no value suits every use of an input, in a locale or across them", async () => {
		const closed = (match: Record<string, string>) => [
			{ declarations: ["input n"], selectors: ["n"], match },
		];
		expect(
			await errorsOf({
				en: {
					paid: "{x :currency currency=$x}",
					listed: "{x :list}",
					named: closed({ "n=a": "{n :number}", "n=b": "{n :number}" }),
					picked: closed({ "n=a": "A", "n=b": "B" }),
				},
				de: {
					paid: "{x :currency currency=$x}",
					listed: "{x :number}",
					named: closed({ "n=a": "{n :number}", "n=b": "{n :number}" }),
					picked: closed({ "n=c": "C" }),
				},
			}),
		).toEqual([
			'message-invalid: messages/de.json: "listed" (de): x is formatted as a list in en and is formatted as a number in de, and no value suits both. Give each use its own input.',
			'message-invalid: messages/de.json: "picked" (de): n is selected without * on a, b in en and is selected without * on c in de, and no value suits both. Give each use its own input.',
			'message-invalid: messages/en.json: "named" (en): n is selected without * on a, b in en and is formatted as a number in en, and no value suits both. Give each use its own input.',
			'message-invalid: messages/en.json: "paid" (en): x is formatted as a number in en and gives a value its currency in en, and no value suits both. Give each use its own input.',
		]);
	});

	it("names the keys locales list together when no value is one of them all", async () => {
		const closed = (keys: string[]) => [
			{
				declarations: ["input n"],
				selectors: ["n"],
				match: Object.fromEntries(keys.map((key) => [`n=${key}`, key])),
			},
		];
		expect(
			await errorsOf({
				en: { picked: closed(["a", "b"]) },
				de: { picked: closed(["a", "c"]) },
				ru: { picked: closed(["b", "c"]) },
			}),
		).toEqual([
			'message-invalid: messages/ru.json: "picked" (ru): n is selected without * on a in en, de and is selected without * on b, c in ru, and no value suits both. Give each use its own input.',
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

it("sorts the places of one file by line and column, as numbers", () => {
	const at = (file: string) => new GraiError("key-missing", { file }, "x");

	expect(
		sortErrors([at("a.ts:10:1"), at("a.ts:9:12"), at("a.ts:9:5")]).map(
			({ file }) => file,
		),
	).toEqual(["a.ts:9:5", "a.ts:9:12", "a.ts:10:1"]);
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
