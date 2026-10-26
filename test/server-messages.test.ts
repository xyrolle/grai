import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { describe, expect, it } from "vitest";
import { grai } from "../src/vite.ts";
import { type Messages, project, thrown } from "./project.ts";

const plural = (match: Record<string, string>) => [
	{
		declarations: ["input count", "local countPlural = count: plural"],
		selectors: ["countPlural"],
		match,
	},
];
/** A select with no `*`, which throws for a value it does not list. */
const status = (first: string, second: string) => [
	{
		declarations: ["input code"],
		selectors: ["code"],
		match: { "code=1": first, "code=2": second },
	},
];

const catalogs = {
	en: {
		title: "Title",
		greeting: "Hello {name}",
		items: plural({
			"countPlural=one": "{count} item",
			"countPlural=other": "{count} items",
		}),
		status: status("first", "second"),
		same: "{name}!",
		terms: "Agree to the {#b}terms{/b}",
		welcome: "{#b}Hi{/b} {name}",
	},
	de: {
		title: "Titel",
		greeting: "Hallo {name}",
		items: plural({
			"countPlural=one": "{count} Artikel",
			"countPlural=other": "{count} Artikel",
		}),
		status: status("erster", "zweiter"),
		same: "{name}!",
		terms: "Stimme den {#b}AGB{/b} zu",
		welcome: "{#b}Hallo{/b} {name}",
	},
	ro: {
		title: "Titlu",
		greeting: "Salut {name}",
		items: plural({
			"countPlural=one": "{count} articol",
			"countPlural=few": "{count} articole",
			"countPlural=other": "{count} de articole",
		}),
		status: status("primul", "al doilea"),
		same: "{name}!",
		terms: "Accept {#b}termenii{/b}",
		welcome: "{#b}Salut{/b} {name}",
	},
};

/** What a server build of the catalogs holds: its keys and server.js's withLocale, and its code. */
async function serverBuild(messages: Record<string, unknown> = catalogs) {
	const { dir } = project(messages);
	writeFileSync(
		join(dir, "keys.js"),
		`export { m } from "./out/messages.js";\n`,
	);
	writeFileSync(
		join(dir, "server.js"),
		`export { withLocale } from "./out/server.js";\n`,
	);
	const output = await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins: [grai()],
		build: {
			ssr: true,
			outDir: join(dir, "dist"),
			rolldownOptions: {
				input: { keys: join(dir, "keys.js"), server: join(dir, "server.js") },
			},
		},
	});
	const chunks = (Array.isArray(output) ? output : [output])
		.flatMap((result) => ("output" in result ? result.output : []))
		.filter((file) => file.type === "chunk");
	const entry = (name: string) =>
		pathToFileURL(
			join(
				dir,
				"dist",
				chunks.find((chunk) => chunk.isEntry && chunk.name === name)
					?.fileName ?? "",
			),
		).href;
	const { m }: { m: Messages } = await import(entry("keys"));
	const { withLocale }: { withLocale<T>(locale: string, code: () => T): T } =
		await import(entry("server"));
	return { m, withLocale, code: chunks.map((chunk) => chunk.code).join("\n") };
}

/** Each kind of message with inputs, called as `call` calls it. */
const rendered = (call: (message: string, inputs: object) => unknown) => [
	call("greeting", { name: "Ana" }),
	call("items", { count: 1 }),
	call("items", { count: 3 }),
	call("status", { code: 2 }),
	call("same", { name: "Ana" }),
];

describe("a server build's message with inputs or markup", () => {
	it("renders each locale's code, in the locale a call names and in the request's", async () => {
		const { m, withLocale } = await serverBuild();
		const expected = {
			en: ["Hello Ana", "1 item", "3 items", "second", "Ana!"],
			de: ["Hallo Ana", "1 Artikel", "3 Artikel", "zweiter", "Ana!"],
			ro: ["Salut Ana", "1 articol", "3 articole", "al doilea", "Ana!"],
		};

		for (const [locale, texts] of Object.entries(expected)) {
			expect(rendered((key, inputs) => m[key]?.(inputs, { locale }))).toEqual(
				texts,
			);
			expect(
				withLocale(locale, () => rendered((key, inputs) => m[key]?.(inputs))),
			).toEqual(texts);
		}
	});

	it("renders a message with markup's text and its parts in each locale, named and the request's", async () => {
		const { m, withLocale } = await serverBuild();
		const drawn = (call: (key: string, inputs: object) => unknown) => [
			call("terms", {}),
			call("welcome", { name: "Ana" }),
		];
		const markup = m as Record<
			string,
			{
				(inputs: object, options?: { locale?: string }): string;
				parts(inputs: object, options?: { locale?: string }): unknown[];
			}
		>;
		const b = (value: string) => [
			{ type: "markup-start", name: "b", options: {}, attributes: {} },
			{ type: "text", value },
			{ type: "markup-end", name: "b", options: {}, attributes: {} },
		];
		const expected = {
			en: {
				text: ["Agree to the terms", "Hi Ana"],
				parts: [
					[{ type: "text", value: "Agree to the " }, ...b("terms")],
					[
						...b("Hi"),
						{ type: "text", value: " " },
						{ type: "text", value: "Ana" },
					],
				],
			},
			ro: {
				text: ["Accept termenii", "Salut Ana"],
				parts: [
					[{ type: "text", value: "Accept " }, ...b("termenii")],
					[
						...b("Salut"),
						{ type: "text", value: " " },
						{ type: "text", value: "Ana" },
					],
				],
			},
		};

		for (const [locale, { text, parts }] of Object.entries(expected)) {
			expect(drawn((key, inputs) => markup[key]?.(inputs, { locale }))).toEqual(
				text,
			);
			expect(
				drawn((key, inputs) => markup[key]?.parts(inputs, { locale })),
			).toEqual(parts);
			expect(
				withLocale(locale, () =>
					drawn((key, inputs) => markup[key]?.parts(inputs)),
				),
			).toEqual(parts);
		}
		expect(
			thrown(() => markup.terms?.parts({}, { locale: "fr" })),
		).toMatchObject({
			code: "locale-unknown",
		});
	});

	it("throws as keys.js does: for a locale the project lacks, outside a request, and for a value a select does not list", async () => {
		const { m, withLocale } = await serverBuild();

		expect(
			thrown(() => m.greeting?.({ name: "Ana" }, { locale: "fr" })),
		).toMatchObject({
			name: "GraiError",
			code: "locale-unknown",
			message: '"fr" is not one of the project\'s locales: en, de, ro.',
		});
		expect(thrown(() => m.greeting?.({ name: "Ana" }))).toMatchObject({
			code: "locale-unbound",
		});
		expect(
			thrown(() => withLocale("de", () => m.status?.({ code: 3 }))),
		).toMatchObject({
			code: "value-unmatched",
			message:
				'"status" (de) has no variant for code=3. Pass one of the values its type lists.',
		});
	});

	it("switches on the locale in its own code, a message with markup in its parts too, and leaves a text to the runtime", async () => {
		const { code } = await serverBuild();

		expect(code).toMatch(
			/greeting = function\(i, o\) \{\s*switch \(localeIndex\(o\)\) \{\s*case 0: return `Hello \$\{i\["name"\]\}`;\s*case 1: return `Hallo \$\{i\["name"\]\}`;\s*default: return `Salut \$\{i\["name"\]\}`;\s*\}\s*\};/,
		);
		expect(code).toContain(
			'title = /*#__PURE__*/ text("Title", "Titel", "Titlu");',
		);
		expect(code).toMatch(
			/terms = \/\*#__PURE__\*\/ withParts\(function\(i, o\) \{\s*switch \(localeIndex\(o\)\) \{\s*case 0: return "Agree to the terms";[^]*?\}, function\(i, o\) \{\s*switch \(localeIndex\(o\)\) \{\s*case 0: return \[/,
		);
		expect(code).not.toMatch(/= \/\*#__PURE__\*\/ (message|markup)\(/);
	});

	it("names its options apart from what its module binds, the key's own name too", async () => {
		const { m, withLocale, code } = await serverBuild({
			en: { o: "Hi {name}" },
			de: { o: "Hallo {name}" },
		});

		expect(code).toMatch(
			/o = function\(i, \$o\) \{\s*switch \(localeIndex\(\$o\)\)/,
		);
		expect(withLocale("de", () => m.o?.({ name: "Ana" }))).toBe("Hallo Ana");
	});

	it("leaves a client build as keys.js has it: no page calls localeIndex or withParts", async () => {
		const { dir } = project(catalogs);
		writeFileSync(
			join(dir, "page.js"),
			`import { m } from "./out/messages.js";\ndocument.body.textContent = m.greeting({ name: "Ana" }) + m.items({ count: 1 }) + m.terms.parts().length;\n`,
		);
		await build({
			root: dir,
			configFile: false,
			logLevel: "silent",
			plugins: [grai()],
			build: {
				outDir: join(dir, "dist"),
				rolldownOptions: { input: { page: join(dir, "page.js") } },
			},
		});
		const assets = join(dir, "dist", "assets");
		const code = readdirSync(assets, { recursive: true })
			.map(String)
			.filter((file) => file.endsWith(".js"))
			.map((file) => readFileSync(join(assets, file), "utf8"))
			.join("\n");

		expect(code).toContain("Hallo");
		expect(code).not.toContain("localeIndex");
		expect(code).not.toContain("withParts");
	});
});
