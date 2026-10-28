import {
	existsSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import type { CompileResult } from "../src/compile.ts";
import { withoutContentHash } from "../src/content-names.ts";
import { isCompiled } from "../src/output-inputs.ts";
import { savedBuild } from "../src/saved-build.ts";
import { savedGroups } from "../src/saved-groups.ts";
import { watch } from "../src/watch.ts";
import {
	isDeclarations,
	outputTexts,
	unresolvedImports,
} from "./output-files.ts";
import { project } from "./project.ts";

const catalogs = {
	en: { title: "Title" },
	de: { title: "Titel" },
};

it("closes once the compile under way has finished, so the project can be removed", async () => {
	const { dir, config } = project(catalogs);
	const reported: CompileResult[] = [];
	const failures: unknown[] = [];
	const watcher = watch(
		config,
		(result) => reported.push(result),
		(error) => failures.push(error),
	);

	await watcher.close();
	const written = existsSync(join(dir, "out", "messages.js"));
	rmSync(dir, { recursive: true, force: true });

	expect({ written, reported, failures }).toEqual({
		written: true,
		reported: [],
		failures: [],
	});
});

it("gives a compile that throws to failed, and compiles again on the next change", async () => {
	const { dir, config } = project(catalogs);
	// A file where the outdir goes: writing the output throws.
	writeFileSync(join(dir, "out"), "");
	let next: (value: unknown) => void = () => {};
	const settled = () =>
		new Promise((resolve) => {
			next = resolve;
		});
	let outcome = settled();
	const watcher = watch(
		config,
		(result) => next(result),
		(error) => next(error),
	);
	onTestFinished(() => watcher.close());

	expect(await outcome).toMatchObject({ code: "ENOTDIR" });
	rmSync(join(dir, "out"));
	outcome = settled();
	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ title: "Überschrift" }),
	);
	expect(await outcome).toMatchObject({ errors: [] });
	expect(existsSync(join(dir, "out", "messages.js"))).toBe(true);
});

/** A watcher of the project whose reports the test reads, closed when the test ends. */
function watched(config: string) {
	const reported: CompileResult[] = [];
	const failures: unknown[] = [];
	const watcher = watch(
		config,
		(result) => reported.push(result),
		(error) => failures.push(error),
	);
	onTestFinished(async () => {
		await watcher.close();
		expect(failures).toEqual([]);
	});
	return reported;
}

it("reads a catalog that a save truncates and then writes once the save has settled", async () => {
	const { dir, config } = project(catalogs);
	const reported = watched(config);
	await expect.poll(() => reported.length).toBe(1);
	const catalog = join(dir, "messages", "de.json");

	// As an editor saves: the file is empty for a moment before its new content is written.
	writeFileSync(catalog, "");
	await new Promise((resolve) => setTimeout(resolve, 5));
	writeFileSync(catalog, JSON.stringify({ title: "Überschrift" }));

	await expect.poll(() => reported.length).toBe(2);
	expect(reported[1]?.errors).toEqual([]);
	expect(reported[1]?.written.map(withoutContentHash)).toContain("keys/0.js");
});

it("compiles a save that leaves the catalog whole on its first event, without waiting for the files to be quiet", async () => {
	const { dir, config } = project(catalogs);
	const reported = watched(config);
	await expect.poll(() => reported.length).toBe(1);
	const catalog = join(dir, "messages", "de.json");

	writeFileSync(catalog, JSON.stringify({ title: "Überschrift" }));
	// Events keep coming for a second, as a slow save's do: waiting for quiet would wait it out.
	const touched = setInterval(
		() => utimesSync(catalog, new Date(), new Date()),
		5,
	);
	onTestFinished(() => clearInterval(touched));

	await expect
		.poll(() => reported[1]?.written.map(withoutContentHash), {
			timeout: 500,
		})
		.toContain("keys/0.js");
});

it("reports no compile that changed nothing, as one that an event late from a save starts", async () => {
	const { dir, config } = project(catalogs);
	const reported = watched(config);
	await expect.poll(() => reported.length).toBe(1);
	const catalog = join(dir, "messages", "de.json");
	const state = join(dir, "out", ".grai");

	// Another writer holds the output, so the compile an event starts waits where the test sees it,
	// having read the catalogs as they are: an event that changes nothing. With this process's claim
	// gone, the compile makes it again as it comes to the lock, which shows it is there.
	const claims = () =>
		readdirSync(state).filter((name) =>
			name.startsWith(`lock.${process.pid}.`),
		);
	for (const claim of claims()) rmSync(join(state, claim));
	writeFileSync(join(state, "lock"), String(process.pid));
	utimesSync(catalog, new Date(), new Date());
	await expect.poll(() => claims().length).toBe(1);
	rmSync(join(state, "lock"));
	writeFileSync(catalog, JSON.stringify({ title: "Überschrift" }));

	await expect.poll(() => reported.length).toBe(2);
	expect(reported[1]?.written.map(withoutContentHash)).toContain("keys/0.js");
	expect(reported.map((result) => result.written.length > 0)).toEqual([
		true,
		true,
	]);
});

it("reports a broken catalog after its save, without waiting for another", async () => {
	const { dir, config } = project(catalogs);
	const reported = watched(config);
	await expect.poll(() => reported.length).toBe(1);

	writeFileSync(join(dir, "messages", "de.json"), '{ "title": "Tit');

	await expect
		.poll(() => reported[1]?.errors.map((error) => error.code))
		.toEqual(["catalog-invalid"]);
});

it("compiles for development, with the config's pseudo-locale", async () => {
	const { config } = project(catalogs, { pseudoLocale: "en-XA" });
	let reported: (locales: readonly string[] | undefined) => void = () => {};
	const locales = new Promise((resolve) => {
		reported = resolve;
	});
	const watcher = watch(
		config,
		(_result, _milliseconds, build) => reported(build?.config.locales),
		() => reported(undefined),
	);
	onTestFinished(() => watcher.close());

	expect(await locales).toEqual(["en", "de", "en-XA"]);
});

it("settles the first compile once its read again of a catalog met mid-save has ended, after its report", async () => {
	const { dir, config } = project(catalogs);
	// The catalog is broken from the start, so the first compile reads it again once the files are
	// quiet, and that read's result stands.
	writeFileSync(join(dir, "messages", "de.json"), '{ "title": "Tit');
	const events: string[] = [];
	const watcher = watch(
		config,
		(result) =>
			events.push(`report ${result.errors.map(({ code }) => code).join()}`),
		() => events.push("failed"),
	);
	onTestFinished(() => watcher.close());

	const compiled = await watcher.first;
	events.push("first");

	expect(
		"result" in compiled && compiled.result.errors.map(({ code }) => code),
	).toEqual(["catalog-invalid"]);
	expect(events).toEqual(["report catalog-invalid", "first"]);
});

/** A watcher of the project whose first compile is given groups, as Next's start gives them. */
function placed(config: string) {
	const asked: number[] = [];
	const reported: CompileResult[] = [];
	const watcher = watch(
		config,
		(result) => reported.push(result),
		(error) => {
			throw error;
		},
		{
			placeFirst: async (compilation) => {
				asked.push(compilation.keys.size);
				return { groups: Promise.resolve([["title"]]), waited: true };
			},
		},
	);
	return { watcher, asked, reported };
}

it("places the keys by the groups the first compile is given, and saves that build for the next start, which takes it up and saves nothing", async () => {
	const { dir, config } = project(catalogs);
	const outdir = join(dir, "out");
	const { watcher } = placed(config);
	await watcher.first;
	await watcher.close();

	expect(savedGroups(outdir)).toEqual([["title"]]);

	expect(
		readdirSync(join(outdir, "keys")).some((name) => /^g0-.*\.js$/.test(name)),
	).toBe(true);
	const saved = join(outdir, ".grai", "build");
	const build = await savedBuild(config, { pseudoLocale: true });
	expect(build?.rendered.groups).toBe(JSON.stringify([["title"]]));
	const { mtimeMs } = statSync(saved);
	const restarted = watch(
		config,
		() => {},
		() => {},
	);
	await restarted.first;
	await restarted.close();
	expect(statSync(saved).mtimeMs).toBe(mtimeMs);
});

it("asks no compile after the first for the groups", async () => {
	const { dir, config } = project(catalogs);
	const { watcher, asked, reported } = placed(config);
	onTestFinished(() => watcher.close());
	await watcher.first;

	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ title: "Überschrift" }),
	);
	await expect.poll(() => reported.length).toBe(2);

	expect(asked).toEqual([1]);
});

/** A watcher that serves its first compile before it writes it, and the reports the test reads. */
function servingWatcher(config: string) {
	const reported: CompileResult[] = [];
	const failures: unknown[] = [];
	const served = Promise.withResolvers<void>();
	const watcher = watch(
		config,
		(result) => reported.push(result),
		(error) => failures.push(error),
		{ serve: () => served.resolve() },
	);
	onTestFinished(async () => {
		await watcher.close();
		expect(failures).toEqual([]);
	});
	return { watcher, served: served.promise, reported };
}

it("reports an error only the write of the compile it served finds, as it closes before the process is quiet", async () => {
	const { config } = project({
		en: { title: "Title", listed: "{x :list}" },
		de: { title: "Titel", listed: "{x :number}" },
	});
	const { watcher, served, reported } = servingWatcher(config);
	await served;

	await watcher.close();

	expect(reported.map(({ errors }) => errors.map(String))).toEqual([
		[
			expect.stringContaining(
				"x is formatted as a list in en and is formatted as a number in de",
			),
		],
	]);
});

it("writes the compile it served when asked, while a catalog is mid-save, and compiles the save once it has settled", async () => {
	const { dir, config } = project(catalogs);
	const { watcher, served, reported } = servingWatcher(config);
	await served;
	const catalog = join(dir, "messages", "de.json");

	writeFileSync(catalog, "");
	const wrote = await watcher.write();

	expect(wrote).toBe(true);
	expect(reported.map(({ errors }) => errors)).toEqual([[]]);
	expect(keysWith(dir, '"Titel"')).toBe(true);
	writeFileSync(catalog, JSON.stringify({ title: "Überschrift" }));
	await expect.poll(() => keysWith(dir, '"Überschrift"')).toBe(true);
	expect(reported.flatMap(({ errors }) => errors)).toEqual([]);
});

/** A watcher that writes its first compile's modules before their declarations, and the reports the test reads. */
function declaringLater(config: string) {
	const reported: CompileResult[] = [];
	const failures: unknown[] = [];
	const watcher = watch(
		config,
		(result) => reported.push(result),
		(error) => failures.push(error),
		{ declareLater: true },
	);
	onTestFinished(async () => {
		await watcher.close();
		expect(failures).toEqual([]);
	});
	return { watcher, reported };
}

it("writes every module of its first compile whole before any declarations, then the declarations and their maps once the process is quiet, and no module again", async () => {
	const { dir, config } = project(catalogs);
	const out = join(dir, "out");
	const { watcher, reported } = declaringLater(config);

	await watcher.first;

	const modules = outputTexts(out);
	expect([...modules.keys()].filter(isDeclarations)).toEqual([]);
	expect(unresolvedImports(out)).toEqual([]);
	expect(await isCompiled(config)).toBe(false);
	const times = [...modules.keys()].map(
		(file) => statSync(join(out, file)).mtimeMs,
	);
	expect(reported).toHaveLength(1);

	await expect.poll(() => reported.length, { timeout: 5000 }).toBe(2);

	const [, declared] = reported;
	expect(declared?.errors).toEqual([]);
	expect(declared?.written).toContain("keys.d.ts");
	expect(declared?.written.filter((file) => !isDeclarations(file))).toEqual([]);
	expect(
		[...modules.keys()].map((file) => statSync(join(out, file)).mtimeMs),
	).toEqual(times);
	expect(await isCompiled(config)).toBe(true);
});

it("writes its first compile's declarations ahead of an edit's compile, and that edit's output after, whole", async () => {
	const { dir, config } = project(catalogs);
	const out = join(dir, "out");
	const { watcher, reported } = declaringLater(config);
	await watcher.first;

	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ title: "Überschrift" }),
	);

	await expect.poll(() => reported.length, { timeout: 5000 }).toBe(3);
	expect(reported.map(({ errors }) => errors)).toEqual([[], [], []]);
	expect(reported[1]?.written.filter((file) => !isDeclarations(file))).toEqual(
		[],
	);
	expect(keysWith(dir, '"Überschrift"')).toBe(true);
	expect(unresolvedImports(out)).toEqual([]);
	expect(await isCompiled(config)).toBe(true);
});

it("reports an error only the declarations find once its first compile's modules are written, and writes no declarations", async () => {
	const { dir, config } = project({
		en: { title: "Title", listed: "{x :list}" },
		de: { title: "Titel", listed: "{x :number}" },
	});
	const { watcher, reported } = declaringLater(config);
	await watcher.first;

	await watcher.close();

	expect(reported.map(({ errors }) => errors.map(String))).toEqual([
		[],
		[
			expect.stringContaining(
				"x is formatted as a list in en and is formatted as a number in de",
			),
		],
	]);
	const out = join(dir, "out");
	expect([...outputTexts(out).keys()].filter(isDeclarations)).toEqual([]);
	expect(unresolvedImports(out)).toEqual([]);
});

/** Whether a module of the output's keys holds a text. */
function keysWith(dir: string, text: string): boolean {
	const keys = join(dir, "out", "keys");
	return (
		existsSync(keys) &&
		readdirSync(keys).some((file) =>
			readFileSync(join(keys, file), "utf8").includes(text),
		)
	);
}

it("writes what it served when asked as soon as it has served it, while its compile is still ending", async () => {
	const { dir, config } = project(catalogs);
	const { watcher, served } = servingWatcher(config);
	await served;

	expect(await watcher.write()).toBe(true);
	expect(keysWith(dir, '"Titel"')).toBe(true);
});

it("compiles an edit saved just as the write of what it served begins, its watch kept", async () => {
	const { dir, config } = project(catalogs);
	const { watcher, served } = servingWatcher(config);
	await served;
	const catalog = join(dir, "messages", "de.json");

	// The save's event comes on a later turn; in this one, the write of what was served begins.
	writeFileSync(catalog, JSON.stringify({ title: "Überschrift" }));
	await watcher.write();

	await expect.poll(() => keysWith(dir, '"Überschrift"')).toBe(true);
});
