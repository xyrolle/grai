import { execFile } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { project } from "./project.ts";

const tsc = fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));

/** Type-checks a file in the project with TypeScript, returning each error's line and code. */
async function typeErrors(
	dir: string,
	file: string,
	source: string,
): Promise<string[]> {
	writeFileSync(join(dir, "package.json"), '{ "type": "module" }');
	writeFileSync(join(dir, file), source);
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				module: "nodenext",
				target: "es2024",
				strict: true,
				noEmit: true,
			},
			files: [file],
		}),
	);
	const output = await promisify(execFile)(tsc, ["-p", dir]).then(
		() => "",
		(error: { stdout: string }) => error.stdout,
	);
	return [...output.matchAll(/\((\d+),\d+\): error (TS\d+)/g)].map(
		([, line, code]) => `${line} ${code}`,
	);
}

it("types each message's inputs and options from its catalogs", async () => {
	const { dir, compile } = project({
		en: {
			title: "Title",
			greeting: "Hello {name}",
			items: [
				{
					declarations: ["input count", "local countPlural = count: plural"],
					selectors: ["countPlural"],
					match: {
						"countPlural=one": "{count} item",
						"countPlural=other": "{count} items",
					},
				},
			],
			month: [
				{
					declarations: ["input month"],
					selectors: ["month"],
					match: { "month=1": "Jan", "month=2": "Feb" },
				},
			],
			terms: "Agree to the {#link}terms{/link}",
		},
		de: {
			title: "Titel",
			greeting: "Hallo {name}",
			items: "{count} Artikel",
			month: [
				{
					declarations: ["input month"],
					selectors: ["month"],
					match: { "month=1": "Jan.", "month=2": "Feb." },
				},
			],
			terms: "Den {#link}Bedingungen{/link} zustimmen",
		},
	});
	expect((await compile()).errors).toEqual([]);

	const errors = await typeErrors(
		dir,
		"use.ts",
		`import { m } from "./out/messages.js";
import { type Locale, locales, type MessagePart } from "./out/runtime.js";
const texts: string[] = [
	m.title(),
	m.title({}, { locale: "de" }),
	m.greeting({ name: "Ana" }),
	m.items({ count: 2 }),
	m.month({ month: 1 }),
	m.month({ month: "2" }),
	m.terms(),
];
const parts: MessagePart[] = m.terms.parts();
const locale: Locale = locales[1];
m.greeting({});
m.greeting({ name: "Ana" }, { locale: "fr" });
m.items({ count: "2" });
m.month({ month: 3 });
m.title.parts;
m.missing();
console.log(texts, parts, locale);
`,
	);

	// Lines 14 to 19, each a wrong call: a missing input, an unknown locale, a count as text, a month
	// the select does not list, parts of a message without markup, and a key that does not exist.
	expect(errors).toEqual([
		"14 TS2741",
		"15 TS2322",
		"16 TS2322",
		"17 TS2322",
		"18 TS2339",
		"19 TS2339",
	]);
});
