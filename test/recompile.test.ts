import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import type { Catalog } from "../src/catalog.ts";
import { catalogKeys } from "../src/catalog-keys.ts";
import { type Build, recompile } from "../src/compile.ts";
import { withoutContentHash } from "../src/content-names.ts";
import { editedMessages } from "../src/edit.ts";
import { readManifest } from "../src/manifest.ts";
import { outputFile, project } from "./project.ts";

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}", footer: "Footer" },
	de: { title: "Titel", greeting: "Hallo {name}", footer: "Fußzeile" },
};

/** A full garbage collection, for a test that a value is no longer held. */
setFlagsFromString("--expose-gc");
const collect: () => void = runInNewContext("gc");

/** Every file of a project's output but its state, by its path in the output. */
/**
 * The files a project's output names, as its manifest records them, with what each holds; not
 * those a compile replaced, which stay a while for readers still loading them.
 */
const outputOf = async (dir: string) => {
	const manifest = await readManifest(join(dir, "out", ".grai"));
	const files = [
		...(manifest?.immutable ?? []),
		...Object.keys(manifest?.mutable ?? {}),
	].sort();
	return new Map(
		files.map((file) => [file, readFileSync(join(dir, "out", file), "utf8")]),
	);
};

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
	it("compiles only the keys the edit touched, and replaces only their module, in place under its name", async () => {
		const { dir, config } = project(catalogs);
		const first = await recompile(config, undefined);
		writeFileSync(
			join(dir, "messages", "de.json"),
			laidOut({ ...catalogs.de, title: "Überschrift" }),
		);
		const second = await recompile(config, first.build);

		const module = first.result.written.find((file) => /^keys\/0-/.test(file));
		expect(second.result.written).toEqual([module]);
		expect(readFileSync(join(dir, "out", module ?? ""), "utf8")).toContain(
			'"Überschrift"',
		);
		expect([...(second.build?.compilation.changed ?? [])]).toEqual(["title"]);
	});

	it("replaces a module of keys in place when an edit changes the base locale's words, which its declarations show", async () => {
		const { dir, config } = project(catalogs);
		const first = await recompile(config, undefined);
		writeFileSync(
			join(dir, "messages", "en.json"),
			laidOut({ ...catalogs.en, greeting: "Hi {name}" }),
		);
		const second = await recompile(config, first.build);

		const shard = first.result.written.filter((file) =>
			/^keys\/0-.*\.(js|d\.ts)$/.test(file),
		);
		expect(second.result.written).toEqual(shard);
		expect(readFileSync(join(dir, "out", shard[1] ?? ""), "utf8")).toContain(
			"/** Hi {name} */",
		);
	});

	it("renames a module of keys, and the entries naming it, when an edit adds a key to it", async () => {
		const { dir, config } = project(catalogs);
		const first = await recompile(config, undefined);
		for (const [locale, messages] of Object.entries(catalogs)) {
			writeFileSync(
				join(dir, "messages", `${locale}.json`),
				laidOut({ ...messages, subtitle: `${messages.title}!` }),
			);
		}
		const second = await recompile(config, first.build);

		const module = (written: readonly string[]) =>
			written.find((file) => /^keys\/0-.*\.js$/.test(file));
		expect(module(second.result.written)).not.toBe(
			module(first.result.written),
		);
		expect(second.result.written.map(withoutContentHash)).toEqual([
			"keys/0.js",
			"keys/0.d.ts",
			"keys/0.d.ts.map",
			"keys.js",
			"keys.d.ts",
		]);
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
			["(i) => `Hello $" + '{i["name"]}`', "(i) => `Hallo $" + '{i["name"]}`'],
		]);
	});

	it("writes formats.js when an edit formats a value, and names none when no message formats one", async () => {
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
		const formats = readFileSync(await outputFile(dir, "formats.js"), "utf8");
		write("Hello {name}", "Hallo {name}");
		const plain = await recompile(config, formatted.build);

		expect(formatted.result.written.map(withoutContentHash)).toContain(
			"formats.js",
		);
		expect(formats).toContain("export const number_de = ");
		expect(plain.build?.rendered.modules.formats).toBeUndefined();
		await expect(outputFile(dir, "formats.js")).rejects.toThrow();
	});

	it("writes after a run of edits what a compile from nothing writes", async () => {
		const { dir, config } = project(catalogs);
		const edits = [
			{ ...catalogs.de, title: "Überschrift" },
			{ ...catalogs.de, title: "Überschrift", footer: "Fuß" },
			{ ...catalogs.de, footer: "Fuß" },
		];
		let { build } = await recompile(config, undefined);
		for (const edit of edits) {
			writeFileSync(join(dir, "messages", "de.json"), laidOut(edit));
			({ build } = await recompile(config, build));
		}
		const fresh = project({ en: catalogs.en, de: edits.at(-1) });
		await recompile(fresh.config, undefined);

		const output = await outputOf(dir);
		expect([...output.keys()].map(withoutContentHash)).toContain("keys/0.js");
		expect(output).toEqual(await outputOf(fresh.dir));
	});

	it("writes after edits that rename formats.js or the plural rules, across shards, what a compile from nothing writes", async () => {
		// Enough keys for several shards, and in each, likely, keys no edit touches that call a
		// formatter or the plural rules: their shards import the module the edits rename.
		const plural = [
			{
				declarations: ["input count", "local n = count: number"],
				selectors: ["n"],
				match: { "n=one": "{n} item", "n=*": "{n} items" },
			},
		];
		const texts = (locale: string) =>
			Object.fromEntries(
				Array.from({ length: 1200 }, (_, index) => [
					`text_${index}`,
					index % 100 === 0
						? `${locale} {amount :number style=currency currency=EUR}`
						: index % 100 === 50
							? plural
							: `${locale} ${index}`,
				]),
			);
		const rounded = [
			{
				declarations: [
					"input count",
					"local n = count: number minimumFractionDigits=1",
				],
				selectors: ["n"],
				match: { "n=one": "{n} one", "n=*": "{n}" },
			},
		];
		const versions = [
			{ price: "{amount :number minimumFractionDigits=2}" },
			{ price: "{amount :number minimumFractionDigits=3}" },
			{ price: "{amount :number minimumFractionDigits=3}", rounded },
			{ price: "{amount :number style=percent}" },
		];
		const catalogsAt = (version: Record<string, unknown>) => ({
			en: { ...texts("en"), ...version },
			de: { ...texts("de"), ...version },
		});
		const { dir, config } = project(catalogsAt(versions[0] ?? {}));
		let { build } = await recompile(config, undefined);
		for (const version of versions.slice(1)) {
			const next = catalogsAt(version);
			writeFileSync(join(dir, "messages", "en.json"), laidOut(next.en));
			writeFileSync(join(dir, "messages", "de.json"), laidOut(next.de));
			({ build } = await recompile(config, build));
			const fresh = project(next);
			await recompile(fresh.config, undefined);

			expect(build?.rendered.shards.length).toBeGreaterThan(1);
			expect(await outputOf(dir)).toEqual(await outputOf(fresh.dir));
		}
	});

	it("keeps formats.js while the messages call the same formatters, and writes what a compile from nothing writes", async () => {
		const versions = [
			{ price: "{amount :number style=currency currency=EUR} total" },
			{ price: "{amount :number style=currency currency=EUR} in all" },
			{ price: "{amount :number style=currency currency=USD} in all" },
			{
				price: "{amount :number style=currency currency=USD} in all",
				title: "{n :number}",
			},
		];
		const catalogsAt = (version: Record<string, string>) => ({
			en: { ...catalogs.en, ...version },
			de: { ...catalogs.de, ...version },
		});
		const { dir, config } = project(catalogsAt(versions[0] ?? {}));
		let { build } = await recompile(config, undefined);
		const formatsFiles = [build?.rendered.modules.formats];
		for (const version of versions.slice(1)) {
			const next = catalogsAt(version);
			writeFileSync(join(dir, "messages", "en.json"), laidOut(next.en));
			writeFileSync(join(dir, "messages", "de.json"), laidOut(next.de));
			({ build } = await recompile(config, build));
			formatsFiles.push(build?.rendered.modules.formats);
			const fresh = project(next);
			await recompile(fresh.config, undefined);

			expect(await outputOf(dir)).toEqual(await outputOf(fresh.dir));
		}
		const [first, sameFormatters, otherCurrency, oneMore] = formatsFiles;
		expect(sameFormatters).toBe(first);
		expect(new Set([first, otherCurrency, oneMore]).size).toBe(3);
	});

	it("renders again, when an edit renames formats.js, only the shards whose keys call a formatter", async () => {
		// Many shards of text, and one key that formats a price.
		const texts = (locale: string) =>
			Object.fromEntries(
				Array.from({ length: 1200 }, (_, index) => [
					`text_${index}`,
					`${locale} ${index}`,
				]),
			);
		const priced = (currency: string) => ({
			en: {
				...texts("en"),
				price: `{amount :number style=currency currency=${currency}}`,
			},
			de: {
				...texts("de"),
				price: `{amount :number style=currency currency=${currency}}`,
			},
		});
		const { dir, config } = project(priced("EUR"));
		const { build: before } = await recompile(config, undefined);
		const next = priced("USD");
		writeFileSync(join(dir, "messages", "en.json"), laidOut(next.en));
		writeFileSync(join(dir, "messages", "de.json"), laidOut(next.de));
		const { build: after } = await recompile(config, before);

		expect(after?.rendered.modules.formats).not.toBe(
			before?.rendered.modules.formats,
		);
		const kept = [...(after?.rendered.shardFiles ?? [])].map(
			([index, files]) =>
				files.declared?.lines ===
				before?.rendered.shardFiles.get(index)?.declared?.lines,
		);
		// Every shard but the price's keeps what it was rendered as.
		expect(kept.length).toBeGreaterThan(2);
		expect(kept.filter((same) => !same)).toHaveLength(1);
	});

	it("keeps formats.js as the last render made it through an edit that calls the same formatters", async () => {
		const priced = (label: string) => ({
			en: {
				...catalogs.en,
				price: `${label} {amount :number style=currency currency=EUR}`,
			},
			de: {
				...catalogs.de,
				price: `${label} {amount :number style=currency currency=EUR}`,
			},
		});
		const { dir, config } = project(priced("Total"));
		const { build: before } = await recompile(config, undefined);
		const next = priced("Sum");
		writeFileSync(join(dir, "messages", "en.json"), laidOut(next.en));
		const { build: after } = await recompile(config, before);

		expect(after?.compilation.changed).toEqual(new Set(["price"]));
		expect(after?.rendered.formats).toBe(before?.rendered.formats);
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

	it("writes plurals.js to read shown digits when an edit selects on a rounding number, and back when none does", async () => {
		const { dir, config } = project(catalogs);
		const first = await recompile(config, undefined);
		const write = (en: unknown, de: unknown) => {
			writeFileSync(
				join(dir, "messages", "en.json"),
				laidOut({ ...catalogs.en, greeting: en }),
			);
			writeFileSync(
				join(dir, "messages", "de.json"),
				laidOut({ ...catalogs.de, greeting: de }),
			);
		};
		const rounded = [
			{
				declarations: [
					"input count",
					"local n = count: number minimumFractionDigits=1",
				],
				selectors: ["n"],
				match: { "n=one": "{n} one", "n=*": "{n}" },
			},
		];
		const plurals = async () =>
			readFileSync(await outputFile(dir, "plurals.js"), "utf8");
		write(rounded, rounded);
		const selecting = await recompile(config, first.build);
		const digits = await plurals();
		write("Hello {name}", "Hallo {name}");
		await recompile(config, selecting.build);

		expect(selecting.result.written.map(withoutContentHash)).toContain(
			"plurals.js",
		);
		expect(digits).toContain("const countOperands = ");
		expect(await plurals()).not.toContain("countOperands");
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
		expect(readFileSync(await outputFile(dir, "keys/0.js"), "utf8")).toContain(
			"Servus $" + '{i["name"]}',
		);
	});

	it("reports an edit that leaves out the comma after an entry, and so does the next compile", async () => {
		const { dir, config, compile } = project(catalogs);
		const first = await recompile(config, undefined);
		const catalog = join(dir, "messages", "de.json");
		writeFileSync(
			catalog,
			readFileSync(catalog, "utf8").replace('"Titel",', '"Überschrift"'),
		);
		const edited = await recompile(config, first.build);

		expect(edited.result.errors.map((error) => error.code)).toEqual([
			"catalog-invalid",
		]);
		expect((await compile()).errors.map((error) => error.code)).toEqual([
			"catalog-invalid",
		]);
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

	it("are left to a whole parse when an entry lacks its comma, or the last has one", () => {
		const text = laidOut(before).toString();
		const edited = (replaced: string, by: string) =>
			editedMessages(
				laidOut(before),
				parsed(before),
				Buffer.from(text.replace(replaced, by)),
			);

		expect(edited('"One",', '"Uno"')).toBeUndefined();
		expect(edited('"Three"\n', '"Tres",\n')).toBeUndefined();
		expect(
			edited('"Three"\n', '"Three"\n\t"fourth": "Four"\n'),
		).toBeUndefined();
	});
});
