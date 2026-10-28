import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { type Build, type CompileResult, recompile } from "../src/compile.ts";
import { savedBuild, savedIndex } from "../src/saved-build.ts";
import { saveGroups } from "../src/saved-groups.ts";
import type { Served } from "../src/served.ts";
import { savingFile } from "../src/state-saves.ts";
import { watch } from "../src/watch.ts";
import { project } from "./project.ts";

const catalogs = {
	en: { title: "Title", cart: "Cart" },
	de: { title: "Titel", cart: "Warenkorb" },
};
const config = { pseudoLocale: "en-XA" };

/** A watcher's first compile, the watcher then closed, which saves its first build. */
async function started(
	file: string,
): Promise<{ result: CompileResult; build: Build | undefined }> {
	const first = Promise.withResolvers<{
		result: CompileResult;
		build: Build | undefined;
	}>();
	const watcher = watch(
		file,
		(result, _milliseconds, build) => first.resolve({ result, build }),
		first.reject,
	);
	const compiled = await first.promise;
	await watcher.close();
	return compiled;
}

/** What a compile from nothing makes of the project as it is now, and whether it writes a file. */
async function fresh(file: string) {
	const { result, build } = await recompile(file, undefined, {
		pseudoLocale: true,
	});
	return { written: result.written, files: build?.rendered.files };
}

const savedFile = (dir: string) => join(dir, "out", ".grai", "build");

it("starts a watcher from the build the last one saved, compiling and saving nothing when nothing changed", async () => {
	const { dir, config: file } = project(catalogs, config);
	const before = await started(file);
	expect(before.build?.compilation.changed.size).toBe(2);
	const saved = statSync(savedFile(dir)).mtimeMs;

	const after = await started(file);

	expect(after.result).toEqual({ written: [], errors: [] });
	expect(after.build?.compilation.changed.size).toBe(0);
	expect(after.build?.compilation.keys).toStrictEqual(
		before.build?.compilation.keys,
	);
	expect(after.build?.rendered).toStrictEqual(before.build?.rendered);
	expect(after.build?.positions).toStrictEqual(before.build?.positions);
	expect(statSync(savedFile(dir)).mtimeMs).toBe(saved);
});

it("saves a first build that placed the keys by groups saved since, and the next start takes it up, placing nothing again", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	await saveGroups(join(dir, "out"), [["title"]]);

	const grouped = await started(file);
	expect(grouped.build?.compilation.changed.size).toBe(0);
	expect(grouped.build?.rendered.groups).toBe(JSON.stringify([["title"]]));
	expect(
		(await savedBuild(file, { pseudoLocale: true }))?.rendered.groups,
	).toBe(JSON.stringify([["title"]]));
	const saved = statSync(savedFile(dir)).mtimeMs;

	const after = await started(file);

	expect(after.result).toEqual({ written: [], errors: [] });
	expect(after.build?.rendered).toStrictEqual(grouped.build?.rendered);
	expect(statSync(savedFile(dir)).mtimeMs).toBe(saved);
});

it("saves a watcher's first build once the process is quiet, while the watcher runs on", async () => {
	const { dir, config: file } = project(catalogs, config);
	const watcher = watch(
		file,
		() => {},
		(error) => {
			throw error;
		},
	);
	onTestFinished(() => watcher.close());

	await expect
		.poll(() => existsSync(savedFile(dir)), { timeout: 5000 })
		.toBe(true);
	expect(await savedBuild(file, { pseudoLocale: true })).toBeDefined();
});

it("saves a watcher's first build as the process exits, before it is quiet", async () => {
	const { config: file } = project(catalogs, config);
	// A process that exits as soon as its watcher reports, as one whose SIGTERM handler exits at once.
	const watching = pathToFileURL(
		fileURLToPath(new URL("../src/watch.ts", import.meta.url)),
	).href;
	const { status, stderr } = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import { watch } from ${JSON.stringify(watching)};
watch(${JSON.stringify(file)}, () => process.exit(0), (error) => {
	console.error(error);
	process.exit(1);
});`,
		],
		{ encoding: "utf8" },
	);

	expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
	expect(await savedBuild(file, { pseudoLocale: true })).toBeDefined();
});

it("saves no build while the process works, as a dev server does as it starts", async () => {
	const { dir, config: file } = project(catalogs, config);
	// The process works 45 ms of every 50, for 30 rounds: three of the saver's windows, and more.
	let rounds = 0;
	const worked = Promise.withResolvers<void>();
	const working = setInterval(() => {
		const until = performance.now() + 45;
		while (performance.now() < until);
		if (++rounds === 30) worked.resolve();
	}, 50);
	onTestFinished(() => clearInterval(working));
	const watcher = watch(
		file,
		() => {},
		(error) => {
			throw error;
		},
	);
	onTestFinished(() => watcher.close());

	await worked.promise;
	expect(existsSync(savedFile(dir))).toBe(false);
	clearInterval(working);
	await expect
		.poll(() => existsSync(savedFile(dir)), { timeout: 5000 })
		.toBe(true);
});

it.each([
	{
		change: "a message changed",
		catalogs: { ...catalogs, de: { ...catalogs.de, title: "Überschrift" } },
		changed: ["title"],
	},
	{
		change: "a key added and another removed",
		catalogs: {
			en: { title: "Title", checkout: "Checkout" },
			de: { title: "Titel", checkout: "Kasse" },
		},
		changed: ["cart", "checkout"],
	},
])(
	"compiles $change while no watcher ran as an edit, into what a compile from nothing makes",
	async (edit) => {
		const { dir, config: file } = project(catalogs, config);
		await started(file);
		for (const [locale, catalog] of Object.entries(edit.catalogs)) {
			writeFileSync(
				join(dir, "messages", `${locale}.json`),
				JSON.stringify(catalog, null, "\t"),
			);
		}

		const after = await started(file);

		expect(after.build?.compilation.changed).toEqual(new Set(edit.changed));
		expect(after.result.written).toContainEqual(
			expect.stringMatching(/^keys\/0-\w+\.js$/),
		);
		expect(await fresh(file)).toEqual({
			written: [],
			files: after.build?.rendered.files,
		});
		// The build it saved in turn has the edit.
		expect((await started(file)).build?.compilation.changed.size).toBe(0);
	},
);

it("writes the output again where another compile wrote over it while no watcher ran", async () => {
	const { config: file, compile } = project(catalogs, config);
	await started(file);
	// A build's compile leaves the pseudo-locale out.
	expect((await compile()).written).toContainEqual(
		expect.stringMatching(/^config-\w+\.js$/),
	);

	const after = await started(file);

	// The entries name the pseudo-locale's modules again, which the build's compile left in place.
	expect(after.build?.compilation.changed.size).toBe(0);
	expect(after.result.written).toContain("keys.js");
	expect(await fresh(file)).toEqual({
		written: [],
		files: after.build?.rendered.files,
	});
});

it("takes up no saved build after the config changed, and saves the build it makes instead", async () => {
	const { config: file } = project(catalogs, config);
	await started(file);
	const written = JSON.parse(readFileSync(file, "utf8"));
	writeFileSync(
		file,
		JSON.stringify({ ...written, strategy: ["cookie"], cookieName: "lang" }),
	);

	const after = await started(file);

	expect(after.build?.compilation.changed.size).toBe(2);
	expect(await fresh(file)).toEqual({
		written: [],
		files: after.build?.rendered.files,
	});
	expect((await started(file)).build?.compilation.changed.size).toBe(0);
});

it("takes up a saved build only for the options it was made with", async () => {
	const { config: file } = project(catalogs, config);
	await started(file);

	expect(await savedBuild(file, { pseudoLocale: true })).toBeDefined();
	expect(await savedBuild(file, {})).toBeUndefined();
});

it.each(["compiler", "runtime"])(
	"takes up no build saved by another %s",
	async (made) => {
		const { dir, config: file } = project(catalogs, config);
		await started(file);
		const bytes = readFileSync(savedFile(dir));
		const end = bytes.indexOf("\n");
		const key = JSON.parse(bytes.subarray(0, end).toString());
		const other = Buffer.from(JSON.stringify({ ...key, [made]: "another" }));
		writeFileSync(savedFile(dir), Buffer.concat([other, bytes.subarray(end)]));

		expect(await savedBuild(file, { pseudoLocale: true })).toBeUndefined();
		expect((await started(file)).build?.compilation.changed.size).toBe(2);
	},
);

it("starts from nothing when the saved build was cut short", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	const bytes = readFileSync(savedFile(dir));
	writeFileSync(savedFile(dir), bytes.subarray(0, bytes.length / 2));

	expect(await savedBuild(file, { pseudoLocale: true })).toBeUndefined();
	expect((await started(file)).build?.compilation.changed.size).toBe(2);
});

it("leaves a save under way alone when a compile under the output's lock clears what compiles left halfway", async () => {
	const { dir, config: file } = project(catalogs, config);
	const { build } = await started(file);
	const state = join(dir, "out", ".grai");
	// A save another process is writing, and a temporary file a compile that stopped halfway left.
	const saving = savingFile(state, "build", process.ppid);
	const leftover = join(state, "keys-0.js.tmp");
	writeFileSync(saving, "part of a build");
	writeFileSync(leftover, "");

	await recompile(file, build, { pseudoLocale: true });

	expect([existsSync(saving), existsSync(leftover)]).toEqual([true, false]);
});

it("removes a save a process left as it crashed, and none whose process still runs", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	const state = join(dir, "out", ".grai");
	// A process that has ended, whose pid no process has yet.
	const { pid: ended } = spawnSync(process.execPath, ["--eval", ""]);
	const stale = savingFile(state, "build", ended);
	const running = savingFile(state, "build", process.ppid);
	writeFileSync(stale, "part of a build");
	writeFileSync(running, "part of a build");
	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogs.de, title: "Überschrift" }, null, "\t"),
	);

	await started(file);

	expect([existsSync(stale), existsSync(running)]).toEqual([false, true]);
	expect(await savedBuild(file, { pseudoLocale: true })).toBeDefined();
});

it("takes up no saved build longer or shorter than it says, as a write over a longer file would leave", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	const bytes = readFileSync(savedFile(dir));
	// A whole build with bytes after it, which V8 reads without a word.
	writeFileSync(savedFile(dir), Buffer.concat([bytes, Buffer.from("more")]));

	expect(await savedBuild(file, { pseudoLocale: true })).toBeUndefined();
	expect((await started(file)).build?.compilation.changed.size).toBe(2);
});

it("saves one whole build when two watchers of an outdir close at once, so no start takes up a mix of them", async () => {
	// Long enough catalogs that a save takes several writes, which two saves at once would interleave.
	const valued = (value: string) =>
		Object.fromEntries(
			Array.from({ length: 5000 }, (_, index) => [
				`key_${index}`,
				`${value} ${index} ${"x".repeat(400)}`,
			]),
		);
	const { dir, config: file } = project(
		{ en: valued("old"), de: valued("alt") },
		config,
	);
	const watching = async () => {
		const first = Promise.withResolvers<void>();
		const watcher = watch(file, () => first.resolve(), first.reject);
		await first.promise;
		return watcher;
	};
	const before = await watching();
	writeFileSync(
		join(dir, "messages", "en.json"),
		JSON.stringify(valued("new"), null, "\t"),
	);
	const after = await watching();

	await Promise.all([before.close(), after.close()]);
	const start = await started(file);

	expect(await fresh(file)).toEqual({
		written: [],
		files: start.build?.rendered.files,
	});
});

/** A watcher that serves before its first compile, as a dev server's does: what it serves, and its first report's build. */
function serving(file: string) {
	const served: Served[] = [];
	const reported = Promise.withResolvers<Build | undefined>();
	const watcher = watch(
		file,
		(_result, _milliseconds, build) => reported.resolve(build),
		reported.reject,
		{ serve: (each) => served.push(each) },
	);
	onTestFinished(() => watcher.close());
	return { served, watcher, reported: reported.promise };
}

/** Each key's code in each locale, as a dev server serves it. */
const codeOf = (served: Served | undefined) =>
	[...(served?.compilation.keys ?? [])].map(([key, { kind, variants }]) => [
		key,
		kind,
		variants,
	]);

it("serves a restart from the saved build's index, the build's own code, and takes the build up after", async () => {
	const { config: file } = project(catalogs, config);
	const before = await started(file);

	const { served, watcher, reported } = serving(file);
	await expect.poll(() => served.length).toBe(1);
	// The index: the build's code, without its catalogs or its output's keys.
	expect("sources" in (served[0] ?? {})).toBe(false);
	expect(codeOf(served[0])).toEqual(codeOf(before.build));

	expect(await watcher.write()).toBe(true);
	const build = await reported;
	expect(build?.compilation.changed.size).toBe(0);
	expect(build?.compilation.keys).toStrictEqual(before.build?.compilation.keys);
});

it("serves no index of a saved build whose catalogs changed since, and compiles the change from the build", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogs.de, title: "Überschrift" }),
	);

	const { served, reported } = serving(file);
	const build = await reported;

	expect(served).toEqual([]);
	expect([...(build?.compilation.changed ?? [])]).toEqual(["title"]);
});

it("reads a saved build's index alone, the build's own code, while the catalogs are as it was compiled from", async () => {
	const { dir, config: file } = project(catalogs, config);
	const { build } = await started(file);

	const saved = await savedIndex(file, { pseudoLocale: true });
	await saved?.close();
	expect(codeOf(saved?.index)).toEqual(codeOf(build));
	expect(saved?.index.rendered.modules).toEqual(build?.rendered.modules);
	expect("sources" in (saved?.index ?? {})).toBe(false);

	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogs.de, title: "Überschrift" }),
	);
	expect(await savedIndex(file, { pseudoLocale: true })).toBeUndefined();
	expect(await savedBuild(file, { pseudoLocale: true })).toBeDefined();
});

it("writes a file of the output gone since the last start, as it takes up the build after serving its index", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	rmSync(join(dir, "out", "messages.js"));

	const { served, watcher } = serving(file);
	await expect.poll(() => served.length).toBe(1);
	expect(await watcher.write()).toBe(true);

	expect(existsSync(join(dir, "out", "messages.js"))).toBe(true);
});

/** The saved file's sections, where they are in its bytes: after the key's and the lengths' lines. */
function sectionsOf(file: string): { index: number; build: number } {
	const bytes = readFileSync(file);
	const start = bytes.indexOf("\n", bytes.indexOf("\n") + 1) + 1;
	const [indexLength = 0] = bytes
		.subarray(bytes.indexOf("\n") + 1, start - 1)
		.toString()
		.split(" ")
		.map(Number);
	return { index: start, build: start + indexLength };
}

/** Changes one byte of a saved file at or after an offset, a text's first letter, keeping its length. */
function corrupted(file: string, from: number, text: string): void {
	const bytes = readFileSync(file);
	const at = bytes.indexOf(text, from);
	expect(at).toBeGreaterThan(-1);
	bytes[at] = "X".charCodeAt(0);
	writeFileSync(file, bytes);
}

it("takes up no section of a saved build whose bytes changed, at the same length, and compiles anew", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	const saved = savedFile(dir);

	// The index's text of a message, and then the build's.
	corrupted(saved, sectionsOf(saved).index, "Titel");
	expect(await savedIndex(file, { pseudoLocale: true })).toBeUndefined();
	expect(await savedBuild(file, { pseudoLocale: true })).toBeDefined();
	corrupted(saved, sectionsOf(saved).build, "Titel");
	expect(await savedBuild(file, { pseudoLocale: true })).toBeUndefined();

	const { served, reported } = serving(file);
	const build = await reported;
	expect(served.map(codeOf)).toEqual([codeOf(build)]);
	expect(JSON.stringify(codeOf(build))).toContain("Titel");
	expect(JSON.stringify(codeOf(build))).not.toContain("Xitel");
});

/**
 * Saves the build of the project's catalogs with `edited` as its German title, as another process
 * would, its bytes then kept and the project put back as it was, catalogs, output and save.
 */
async function anotherSave(dir: string, file: string, edited: string) {
	const catalog = join(dir, "messages", "de.json");
	const before = readFileSync(catalog, "utf8");
	const save = savedFile(dir);
	const kept = readFileSync(save);
	writeFileSync(catalog, JSON.stringify({ ...catalogs.de, title: edited }));
	await started(file);
	const other = readFileSync(save);
	writeFileSync(catalog, before);
	writeFileSync(save, kept);
	await recompile(file, undefined, { pseudoLocale: true });
	return other;
}

/** Puts a save in place as a process saves it: whole, renamed over the last. */
function replaceSave(dir: string, bytes: Buffer): void {
	const save = savedFile(dir);
	writeFileSync(`${save}.next`, bytes);
	renameSync(`${save}.next`, save);
}

it("reads the build of the save it read the index of, whatever another process saves since", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	const other = await anotherSave(dir, file, "Überschrift");

	const saved = await savedIndex(file, { pseudoLocale: true });
	replaceSave(dir, other);
	const build = await saved?.build();

	expect(JSON.stringify(codeOf(build))).toContain("Titel");
	expect(JSON.stringify(codeOf(build))).not.toContain("Überschrift");
});

/** A watcher that serves before its first compile, as a dev server's does: everything it tells. */
function servingAll(file: string) {
	const served: Served[] = [];
	const reported: { result: CompileResult; build: Build | undefined }[] = [];
	const failures: unknown[] = [];
	const firstServed = Promise.withResolvers<void>();
	const watcher = watch(
		file,
		(result, _milliseconds, build) => reported.push({ result, build }),
		(error) => failures.push(error),
		{
			serve: (each) => {
				served.push(each);
				firstServed.resolve();
			},
		},
	);
	onTestFinished(() => watcher.close());
	return {
		served,
		reported,
		failures,
		watcher,
		firstServed: firstServed.promise,
	};
}

it("takes up the build of the save it served the index of, and compiles from it an edit another process saved a build of since", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	const other = await anotherSave(dir, file, "Überschrift");
	const { firstServed, reported } = servingAll(file);
	await firstServed;

	// In one turn, before the watcher hears of the edit: the other save, then the edit it was of.
	replaceSave(dir, other);
	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogs.de, title: "Überschrift" }),
	);

	await expect.poll(() => reported.length).toBeGreaterThan(0);
	expect([...(reported[0]?.build?.compilation.changed ?? [])]).toEqual([
		"title",
	]);
});

it("holds a write after an index, while a catalog is in the middle of a save, until the files have settled and the take-up wrote or reported", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	rmSync(join(dir, "out", "messages.js"));
	const { firstServed, reported, watcher } = servingAll(file);
	await firstServed;
	const catalog = join(dir, "messages", "de.json");

	writeFileSync(catalog, "");
	await watcher.write();

	// The settled read of the catalog, still cut short, is reported: no write ended before it.
	expect(
		reported.flatMap(({ result }) => result.errors.map(({ code }) => code)),
	).toEqual(["catalog-invalid"]);
	writeFileSync(catalog, JSON.stringify(catalogs.de));
	await expect
		.poll(() => existsSync(join(dir, "out", "messages.js")))
		.toBe(true);
});

it("writes a file of the output gone since, as it closes right after serving the index", async () => {
	const { dir, config: file } = project(catalogs, config);
	await started(file);
	rmSync(join(dir, "out", "messages.js"));
	const { firstServed, reported, watcher } = servingAll(file);
	await firstServed;

	await watcher.close();

	expect(existsSync(join(dir, "out", "messages.js"))).toBe(true);
	expect(reported.map(({ result }) => result.errors)).toEqual([[]]);
});

// No mode on Windows takes away a directory's writes.
it.skipIf(process.platform === "win32")(
	"reports a take-up that cannot write the output, as it closes right after serving the index",
	async () => {
		const { dir, config: file } = project(catalogs, config);
		await started(file);
		rmSync(join(dir, "out", "messages.js"));
		const { firstServed, reported, failures, watcher } = servingAll(file);
		await firstServed;
		const out = join(dir, "out");
		chmodSync(out, 0o555);
		onTestFinished(() => chmodSync(out, 0o755));

		await watcher.close();

		const told = [
			...failures,
			...reported.flatMap(({ result }) => result.errors),
		];
		expect(told).not.toEqual([]);
	},
);

it("serves a restart's index in a process that loaded no compiler, and loads it once as it takes up the build", async () => {
	const { config: file } = project(catalogs, config);
	await started(file);
	const watching = pathToFileURL(
		fileURLToPath(new URL("../src/watch.ts", import.meta.url)),
	).href;

	// A process of its own, which counts its loads of the compiler's module.
	const { status, stdout, stderr } = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"--eval",
			`import { registerHooks } from "node:module";
let loads = 0;
registerHooks({
	load(url, context, next) {
		if (url.endsWith("/compile.ts")) loads += 1;
		return next(url, context);
	},
});
const { watch } = await import(${JSON.stringify(watching)});
const served = Promise.withResolvers();
const watcher = watch(${JSON.stringify(file)}, () => {}, (error) => {
	console.error(error);
	process.exit(1);
}, { serve: () => served.resolve() });
await served.promise;
const atIndex = loads;
await watcher.write();
await watcher.close();
console.log(JSON.stringify([atIndex, loads]));`,
		],
		{ encoding: "utf8" },
	);

	expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
	expect(JSON.parse(stdout)).toEqual([0, 1]);
});
