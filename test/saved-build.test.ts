import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { type Build, type CompileResult, recompile } from "../src/compile.ts";
import { savedBuild } from "../src/saved-build.ts";
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

it("saves a watcher's first build a second after it, while the watcher runs on", async () => {
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
	expect((await compile()).written).toContain("config.js");

	const after = await started(file);

	expect(after.build?.compilation.changed.size).toBe(0);
	expect(after.result.written).toContain("config.js");
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
