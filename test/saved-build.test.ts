import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { type Build, type CompileResult, recompile } from "../src/compile.ts";
import { savedBuild, savedIndex } from "../src/saved-build.ts";
import { saveGroups } from "../src/saved-groups.ts";
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

it("reads a saved build's index alone, the build's own code, while the catalogs are as it was compiled from", async () => {
	const { dir, config: file } = project(catalogs, config);
	const { build } = await started(file);

	const index = await savedIndex(file, { pseudoLocale: true });
	const codeOf = (
		keys: ReadonlyMap<string, { variants: unknown }> | undefined,
	) => [...(keys ?? [])].map(([key, { variants }]) => [key, variants]);
	expect(codeOf(index?.compilation.keys)).toEqual(
		codeOf(build?.compilation.keys),
	);
	expect(index?.rendered.modules).toEqual(build?.rendered.modules);
	expect("sources" in (index ?? {})).toBe(false);

	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogs.de, title: "Überschrift" }),
	);
	expect(await savedIndex(file, { pseudoLocale: true })).toBeUndefined();
	expect(await savedBuild(file, { pseudoLocale: true })).toBeDefined();
});
