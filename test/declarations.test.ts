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
			guests: "With {names :list} {days :relativetime unit=day}",
			place: [
				{
					declarations: ["input n", "local nOrdinal = n: plural type=ordinal"],
					selectors: ["nOrdinal"],
					match: { "nOrdinal=one": "{n}st", "nOrdinal=*": "{n}th" },
				},
			],
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
			guests: "Mit {names :list} {days :relativetime unit=day}",
			place: "{n}.",
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
	m.place({ n: 3 }),
	m.guests({ names: ["Ana", "Ion"], days: 2 }),
];
const parts: MessagePart[] = m.terms.parts();
const locale: Locale = locales[1];
m.greeting({});
m.greeting({ name: "Ana" }, { locale: "fr" });
m.items({ count: "2" });
m.place({ n: "3" });
m.guests({ names: "Ana", days: 2 });
m.month({ month: 3 });
m.title.parts;
m.missing();
console.log(texts, parts, locale);
`,
	);

	// Lines 16 to 23, each a wrong call: a missing input, an unknown locale, a count and an ordinal's
	// count as text, a list as text, a month the select does not list, parts of a message without
	// markup, and a key that does not exist.
	expect(errors).toEqual([
		"16 TS2741",
		"17 TS2322",
		"18 TS2322",
		"19 TS2322",
		"20 TS2322",
		"21 TS2322",
		"22 TS2339",
		"23 TS2339",
	]);
});

it("types a markup message's parts by the tags every locale writes, so another tag is a type error", async () => {
	const { dir, compile } = project({
		en: { terms: "Read the {#link href=|/terms|}terms{/link}{#br/}" },
		de: { terms: "Die {#b}Bedingungen{/b} lesen" },
	});
	expect((await compile()).errors).toEqual([]);

	const errors = await typeErrors(
		dir,
		"use.ts",
		`import { m } from "./out/messages.js";
type Tag = Extract<ReturnType<typeof m.terms.parts>[number], { name: string }>["name"];
const exactly: [Tag, "b" | "br" | "link"] extends ["b" | "br" | "link", Tag] ? true : false = true;
const options = m.terms.parts().map((part) => (part.type === "text" ? {} : part.options));
m.terms.parts().some((part) => part.type !== "text" && part.name === "a");
console.log(exactly, options);
`,
	);

	// Line 5 compares a part's name with a tag no locale writes.
	expect(errors).toEqual(["5 TS2367"]);
});

it("lets a message without inputs take none, so an input passed to it is a mistake at the call", async () => {
	const { dir, compile } = project({
		en: { cart_title: "Your cart" },
		de: { cart_title: "Ihr Warenkorb" },
	});
	expect((await compile()).errors).toEqual([]);

	const errors = await typeErrors(
		dir,
		"use.ts",
		`import { m } from "./out/messages.js";
const texts: string[] = [m.cart_title(), m.cart_title({}), m.cart_title({}, { locale: "de" })];
m.cart_title({ count: 1 });
console.log(texts);
`,
	);

	// Line 3: a count passed to a message that takes no inputs.
	expect(errors).toEqual(["3 TS2322"]);
});

it("types a value formatted as a number as a number, and one formatted as a date as a Date or its time value", async () => {
	const { dir, compile } = project({
		en: {
			cart_total: "Total {amount :number style=currency currency=EUR}",
			cart_price: [
				{
					declarations: ["input amount", "local price = amount: integer"],
					selectors: [],
					match: { "": "{price}" },
				},
			],
			cart_shipped: "Shipped {when :date}",
		},
	});
	expect((await compile()).errors).toEqual([]);

	const errors = await typeErrors(
		dir,
		"use.ts",
		`import { m } from "./out/messages.js";
const texts: string[] = [
	m.cart_total({ amount: 12.5 }),
	m.cart_price({ amount: 3 }),
	m.cart_shipped({ when: new Date() }),
	m.cart_shipped({ when: Date.now() }),
];
m.cart_total({ amount: "12.5" });
m.cart_shipped({ when: "today" });
console.log(texts);
`,
	);

	// Lines 8 and 9: a number given as text, and a date given as text.
	expect(errors).toEqual(["8 TS2322", "9 TS2322"]);
});

it("types an input by every use of it in every locale, so a call that type-checks renders", async () => {
	const picked = (one: string, two: string) => [
		{
			declarations: ["input n"],
			selectors: ["n"],
			match: { "n=1": `{n :number} ${one}`, "n=2": `{n :number} ${two}` },
		},
	];
	const { dir, compile } = project({
		en: {
			picked: picked("one", "two"),
			greeting: "Hi {name}",
			paid: "{amount :currency currency=$code}",
		},
		de: {
			picked: picked("eins", "zwei"),
			greeting: "Hallo {name}",
			paid: "{amount :currency currency=$code}",
		},
	});
	expect((await compile()).errors).toEqual([]);

	const errors = await typeErrors(
		dir,
		"use.ts",
		`import { m } from "./out/messages.js";
const texts: string[] = [
	m.picked({ n: 1 }),
	m.picked({ n: 2 }),
	m.greeting({ name: "Ana" }),
	m.greeting({ name: 1n }),
	m.greeting({ name: new Date() }),
	m.paid({ amount: 2, code: "EUR" }),
];
m.picked({ n: 3 });
m.picked({ n: "1" });
m.greeting({ name: Symbol("Ana") });
m.paid({ amount: 2, code: 12 });
console.log(texts);
`,
	);

	// Lines 10 to 13: a number the select does not list, a number given as text, a symbol, which
	// has no text, and a currency given as a number.
	expect(errors).toEqual(["10 TS2322", "11 TS2322", "12 TS2322", "13 TS2322"]);
});

it("types a relative time's unit from an input as one of Intl's units of time", async () => {
	const { dir, compile } = project({
		en: { ago: "{n :relativetime unit=$unit}" },
	});
	expect((await compile()).errors).toEqual([]);

	const errors = await typeErrors(
		dir,
		"use.ts",
		`import { m } from "./out/messages.js";
const texts: string[] = [m.ago({ n: -1, unit: "day" }), m.ago({ n: 2, unit: "weeks" })];
m.ago({ n: 2, unit: "fortnight" });
console.log(texts);
`,
	);

	// Line 3: a unit that is not one of time.
	expect(errors).toEqual(["3 TS2322"]);
});

it("types a runtime GraiError's code as one of the codes the runtime throws", async () => {
	const { dir, compile } = project({
		en: { cart_title: "Your cart" },
		de: { cart_title: "Ihr Warenkorb" },
	});
	expect((await compile()).errors).toEqual([]);

	const errors = await typeErrors(
		dir,
		"use.ts",
		`import type { GraiError } from "./out/runtime.js";
declare const error: GraiError;
const codes: ("locale-unknown" | "locale-not-loaded" | "value-unmatched" | "format-option-invalid" | "locale-unbound")[] = [error.code];
const unbound: GraiError["code"] = "locale-unbound";
const compiling = error.code === "key-missing";
console.log(codes, unbound, compiling);
`,
	);

	// Line 5: a code only the compiler reports, which the runtime never throws.
	expect(errors).toEqual(["5 TS2367"]);
});

it("types setLocale under reload as giving back nothing to await", async () => {
	const catalogs = { en: { title: "Title" }, de: { title: "Titel" } };
	const use = `import { setLocale } from "./out/runtime.js";
const live: Promise<void> = setLocale("de", { reload: false });
console.log(live);
`;
	const reload = project(catalogs);
	expect((await reload.compile()).errors).toEqual([]);

	// Line 2: setLocale gives back nothing to await.
	expect(await typeErrors(reload.dir, "use.ts", use)).toEqual(["2 TS2322"]);
});

it("intersects closed selections as their matching has them: :string's in NFC, and units of time as such", async () => {
	const closed = (
		input: string,
		local: string,
		match: Record<string, string>,
	) => [
		{
			declarations: [`input ${input}`, ...(local === "" ? [] : [local])],
			selectors: [local === "" ? input : "s"],
			match,
		},
	];
	const { dir, compile } = project({
		en: {
			place: closed("place", "local s = place: string", { "s=café": "café" }),
			ago: closed("unit", "", {
				"unit=day": "{n :relativetime unit=$unit}",
				"unit=week": "{n :relativetime unit=$unit}",
			}),
		},
		de: {
			place: closed("place", "local s = place: string", {
				"s=café": "Café",
			}),
			ago: closed("unit", "", {
				"unit=day": "{n :relativetime unit=$unit}",
				"unit=week": "{n :relativetime unit=$unit}",
			}),
		},
	});
	expect((await compile()).errors).toEqual([]);

	const errors = await typeErrors(
		dir,
		"use.ts",
		`import { m } from "./out/messages.js";
const texts: string[] = [m.place({ place: "café" }), m.ago({ n: 1, unit: "week" })];
m.ago({ n: 1, unit: "month" });
console.log(texts);
`,
	);

	// Line 3: a unit the select does not list.
	expect(errors).toEqual(["3 TS2322"]);
});
