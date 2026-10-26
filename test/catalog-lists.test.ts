import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { add } from "../src/add.ts";
import { type Build, type CompileResult, compile } from "../src/compile.ts";
import { withoutContentHash } from "../src/content-names.ts";
import { importCatalogs } from "../src/import.ts";
import { rename } from "../src/rename.ts";
import { seed } from "../src/seed.ts";
import { exportLocale, mergeDocument } from "../src/translations.ts";
import { watch } from "../src/watch.ts";
import { definitionOf } from "./language-server.ts";
import { errorsOf, project } from "./project.ts";

const catalogs = ["messages/{locale}.json", "messages/admin/{locale}.json"];

/** A project whose locales each keep their messages in two files: messages/ and messages/admin/. */
function splitProject(
	main: Record<string, Record<string, unknown>>,
	admin: Record<string, Record<string, unknown>>,
) {
	const shop = project(main, { catalogs });
	mkdirSync(join(shop.dir, "messages", "admin"));
	for (const [locale, messages] of Object.entries(admin)) {
		writeFileSync(
			join(shop.dir, "messages", "admin", `${locale}.json`),
			JSON.stringify(messages, null, "\t"),
		);
	}
	return shop;
}

const read = (dir: string, file: string): unknown =>
	JSON.parse(readFileSync(join(dir, "messages", file), "utf8"));

it("compiles a locale's messages from each of its catalog files", async () => {
	const { m } = await splitProject(
		{ en: { title: "Title" }, de: { title: "Titel" } },
		{ en: { settings: "Settings" }, de: { settings: "Einstellungen" } },
	).load();

	expect([
		m.title?.({}, { locale: "de" }),
		m.settings?.({}, { locale: "de" }),
	]).toEqual(["Titel", "Einstellungen"]);
});

it("is an error when a key is in two files of one locale, naming both", async () => {
	const { compile } = splitProject(
		{ en: { title: "Title" }, de: { title: "Titel" } },
		{ en: { title: "Admin" }, de: { settings: "Einstellungen" } },
	);

	expect((await compile()).errors.map((error) => error.message)).toContain(
		'messages/admin/en.json: "title" (en): the key is in messages/en.json too. Keep it in one of the locale\'s catalogs.',
	);
});

it("adds a new key to the first file, and writes a key back to the file it came from", async () => {
	const { dir, config } = splitProject(
		{ en: { title: "Title" }, de: { title: "Titel" } },
		{ en: { settings: "Settings" }, de: { settings: "Settings" } },
	);

	await add(config, "cart", { en: "Cart", de: "Warenkorb" });
	await rename(config, "settings", "preferences");
	const exported = await exportLocale(config, "de", {
		json: true,
		untranslated: true,
	});
	const document = "document" in exported ? JSON.parse(exported.document) : {};
	document.units[0].target = "Einstellungen";
	writeFileSync(join(dir, "de-units.json"), JSON.stringify(document));
	const merged = await mergeDocument(config, join(dir, "de-units.json"));

	expect(merged).toMatchObject({ messages: 1 });
	expect([read(dir, "de.json"), read(dir, "admin/de.json")]).toEqual([
		{ title: "Titel", cart: "Warenkorb" },
		{ preferences: "Einstellungen" },
	]);
});

it("compiles again in watch when any of a locale's files changes", async () => {
	const { dir, config } = splitProject(
		{ en: { title: "Title" }, de: { title: "Titel" } },
		{ en: { settings: "Settings" }, de: { settings: "Einstellungen" } },
	);
	let next: (result: CompileResult) => void = () => {};
	const reported = () =>
		new Promise<CompileResult>((resolve) => {
			next = resolve;
		});
	let outcome = reported();
	const watcher = watch(
		config,
		(result) => next(result),
		() => {},
	);
	onTestFinished(() => watcher.close());
	await outcome;

	outcome = reported();
	writeFileSync(
		join(dir, "messages", "admin", "de.json"),
		JSON.stringify({ settings: "Optionen" }, null, "\t"),
	);

	const { errors, written } = await outcome;
	const shard = written.find(
		(file) => withoutContentHash(file) === "keys/0.js",
	);

	expect(errors).toEqual([]);
	expect(
		readFileSync(join(dir, "out", shard ?? "keys/0.js"), "utf8"),
	).toContain("Optionen");
});

it("takes catalogs as one path or a list of distinct paths, each with {locale}", async () => {
	const messages = { en: { title: "Title" } };
	const message =
		'config-invalid: grai.config.json: "catalogs" must be a path with {locale} in it, such as "messages/{locale}.json", or a list of distinct such paths, where a locale\'s messages are split across files.';

	expect(await errorsOf(messages, { catalogs: [] })).toEqual([message]);
	expect(
		await errorsOf(messages, {
			catalogs: ["messages/{locale}.json", "x.json"],
		}),
	).toEqual([message]);
	expect(
		await errorsOf(messages, {
			catalogs: ["messages/{locale}.json", "messages/{locale}.json"],
		}),
	).toEqual([message]);
});

it("seeds a key the locale lacks into its file at the place of the base's that has it", async () => {
	const { dir, config } = splitProject(
		{ en: { title: "Title" }, de: { title: "Titel" } },
		{ en: { settings: "Settings" }, de: {} },
	);

	expect(await seed(config, "de")).toMatchObject({
		files: ["messages/admin/de.json"],
		keys: 1,
		result: { errors: [] },
	});
	expect(read(dir, "admin/de.json")).toEqual({ settings: "Settings" });
});

it("takes a file without messages, but not a locale without any", async () => {
	const empty = splitProject(
		{ en: { title: "Title" }, de: { title: "Titel" } },
		{ en: {}, de: {} },
	);
	const bare = splitProject(
		{ en: { title: "Title" }, de: {} },
		{ en: {}, de: {} },
	);

	expect((await empty.compile()).errors).toEqual([]);
	expect((await bare.compile()).errors.map((error) => error.message)).toContain(
		'messages/de.json: the catalog has no messages, so de would render nothing. Add its messages, or remove de from "locales".',
	);
});

it("takes go to definition to the base locale's file that has the key", async () => {
	const { dir, config } = splitProject(
		{ en: { title: "Title" }, de: { title: "Titel" } },
		{ en: { settings: "Settings" }, de: { settings: "Einstellungen" } },
	);
	await compile(config);

	expect([
		await definitionOf(dir, "title"),
		await definitionOf(dir, "settings"),
	]).toEqual([
		[join(dir, "messages", "en.json"), 1, 2],
		[join(dir, "messages", "admin", "en.json"), 1, 2],
	]);
});

it("imports every key into a locale's first file, and writes its others without messages", async () => {
	const { dir, config } = project({ en: {}, de: {} }, { catalogs });
	for (const locale of ["en", "de"]) {
		rmSync(join(dir, "messages", `${locale}.json`));
	}
	mkdirSync(join(dir, "source"));
	writeFileSync(join(dir, "source", "en.json"), '{ "title": "Title" }');
	writeFileSync(join(dir, "source", "de.json"), '{ "title": "Titel" }');

	expect(
		importCatalogs(config, "i18next", [join(dir, "source")]),
	).toMatchObject({
		written: [
			"messages/en.json",
			"messages/de.json",
			"messages/admin/en.json",
			"messages/admin/de.json",
		],
		errors: [],
	});
	expect([read(dir, "de.json"), read(dir, "admin/de.json")]).toMatchObject([
		{ title: "Titel" },
		{},
	]);
	expect((await compile(config)).errors).toEqual([]);
});

it("starts a watcher from the build the last one saved, compiling only the key an edit of a second file changed", async () => {
	const { dir, config } = splitProject(
		{ en: { title: "Title" }, de: { title: "Titel" } },
		{ en: { settings: "Settings" }, de: { settings: "Einstellungen" } },
	);
	const started = async () => {
		const first = Promise.withResolvers<Build | undefined>();
		const watcher = watch(
			config,
			(_result, _milliseconds, build) => first.resolve(build),
			first.reject,
		);
		const build = await first.promise;
		await watcher.close();
		return build;
	};
	await started();
	writeFileSync(
		join(dir, "messages", "admin", "de.json"),
		JSON.stringify({ settings: "Optionen" }, null, "\t"),
	);

	expect((await started())?.compilation.changed).toEqual(new Set(["settings"]));
});
