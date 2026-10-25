import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/catalog.ts";
import { catalogKeys } from "../src/catalog-keys.ts";
import { type Build, recompile } from "../src/compile.ts";
import { editedMessages } from "../src/edit.ts";
import { project } from "./project.ts";

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}", footer: "Footer" },
	de: { title: "Titel", greeting: "Hallo {name}", footer: "Fußzeile" },
};

/** A full garbage collection, for a test that a value is no longer held. */
setFlagsFromString("--expose-gc");
const collect: () => void = runInNewContext("gc");

/** A catalog as editors write it: one entry per line, indented by a tab. */
const laidOut = (messages: Record<string, unknown>) =>
	Buffer.from(JSON.stringify(messages, null, "\t"));

const where = { file: "messages/en.json", locale: "en" };

/** A catalog's parse of these messages. */
const parsed = (messages: Record<string, unknown>): Catalog => ({
	...where,
	...catalogKeys(messages, where),
	revision: Symbol(where.locale),
});

describe("a recompile after an edit", () => {
	it("compiles only the keys the edit touched, and writes only their shard", async () => {
		const { dir, config } = project(catalogs);
		const first = await recompile(config, undefined);
		writeFileSync(
			join(dir, "messages", "de.json"),
			laidOut({ ...catalogs.de, title: "Überschrift" }),
		);
		const second = await recompile(config, first.build);

		expect(second.result.written).toEqual(["keys/0.js"]);
		expect([...(second.build?.compilation.changed ?? [])]).toEqual(["title"]);
	});

	it("keeps each key's message one locale at a time, for adapters that write a module per locale", async () => {
		const { config } = project(catalogs);
		const { build } = await recompile(config, undefined);
		const key = (name: string) => build?.compilation.keys.get(name);

		expect([key("title")?.kind, key("title")?.variants]).toEqual([
			"text",
			['"Title"', '"Titel"'],
		]);
		// "$" and "{" apart, or Biome takes the strings for template literals written by mistake.
		expect([key("greeting")?.kind, key("greeting")?.variants]).toEqual([
			"message",
			["(i) => `Hello $" + "{i.name}`", "(i) => `Hallo $" + "{i.name}`"],
		]);
	});

	it("writes formats.js when an edit formats a value, and removes it when no message formats one", async () => {
		const { dir, config } = project(catalogs);
		const first = await recompile(config, undefined);
		const write = (en: string, de: string) => {
			writeFileSync(
				join(dir, "messages", "en.json"),
				laidOut({ ...catalogs.en, greeting: en }),
			);
			writeFileSync(
				join(dir, "messages", "de.json"),
				laidOut({ ...catalogs.de, greeting: de }),
			);
		};
		write(
			"Hello {name}, {count :number} new",
			"Hallo {name}, {count :number} neu",
		);
		const formatted = await recompile(config, first.build);
		const formats = readFileSync(join(dir, "out", "formats.js"), "utf8");
		write("Hello {name}", "Hallo {name}");
		await recompile(config, formatted.build);

		expect(formatted.result.written).toContain("formats.js");
		expect(formats).toContain("export const number_de = ");
		expect(existsSync(join(dir, "out", "formats.js"))).toBe(false);
	});

	it("holds on to no catalog an edit replaced, so a long run of edits does not add up", async () => {
		const { dir, config } = project(catalogs);
		const built = async (previous?: Build) => {
			const { build, result } = await recompile(config, previous);
			if (build === undefined) throw new Error(result.errors[0]?.message);
			return build;
		};
		let build = await built();
		const replaced = new WeakRef(build.catalogs[0] ?? {});
		for (const title of ["Heading", "Header"]) {
			writeFileSync(
				join(dir, "messages", "en.json"),
				laidOut({ ...catalogs.en, title }),
			);
			build = await built(build);
		}
		await new Promise((resolve) => setImmediate(resolve));
		collect();

		expect(build.catalogs[0]?.messages.get("title")).toBe("Header");
		expect(replaced.deref()).toBeUndefined();
	});

	it("starts again from the last good build after a compile that failed", async () => {
		const { dir, config } = project(catalogs);
		const good = await recompile(config, undefined);
		const catalog = join(dir, "messages", "de.json");
		writeFileSync(
			catalog,
			laidOut({ ...catalogs.de, greeting: "Hallo { name }" }),
		);
		const failed = await recompile(config, good.build);
		writeFileSync(
			catalog,
			laidOut({ ...catalogs.de, greeting: "Servus {name}" }),
		);
		const fixed = await recompile(config, failed.build ?? good.build);

		expect(failed.result.errors.map((error) => error.key)).toEqual([
			"greeting",
		]);
		expect(fixed.result.errors).toEqual([]);
		expect(readFileSync(join(dir, "out", "keys", "0.js"), "utf8")).toContain(
			"Servus $" + "{i.name}",
		);
	});
});

describe("the messages of an edited catalog", () => {
	const before = {
		first: "One",
		second: ["variants"],
		nested: { title: "Title" },
		third: "Three",
	};
	const parse = (messages: Record<string, unknown>) =>
		editedMessages(laidOut(before), parsed(before), laidOut(messages));

	it("are those of a whole parse, from the entries the edit touched alone", () => {
		const edits = [
			{ ...before, second: ["other variants"] },
			{ ...before, fourth: "Four" },
			{ ...before, nested: { title: "Heading", body: "Body" } },
			{ first: "One", second: ["variants"], nested: { title: "Title" } },
			{ ...before, first: "Uno", third: "Tres" },
		];
		for (const edit of edits) {
			const whole = parsed(edit);
			const edited = parse(edit);
			expect(edited?.messages).toEqual(whole.messages);
			expect(edited?.paths).toEqual(whole.paths);
		}
		expect([
			...(parse({ ...before, nested: { title: "Title", body: "Body" } })
				?.keys ?? []),
		]).toEqual(["nested_body"]);
	});

	it("are left to a whole parse when the edit cannot be shown to touch whole entries", () => {
		const oneLine = editedMessages(
			Buffer.from(JSON.stringify(before)),
			parsed(before),
			Buffer.from(JSON.stringify({ ...before, first: "Uno" })),
		);
		const duplicated = editedMessages(
			laidOut(before),
			parsed(before),
			Buffer.from(
				laidOut(before)
					.toString()
					.replace('\t"third"', '\t"first": "Again",\n\t"third"'),
			),
		);

		expect(oneLine).toBeUndefined();
		expect(duplicated).toBeUndefined();
	});
});
