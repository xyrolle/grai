import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import type { CompileResult } from "../src/compile.ts";
import { withoutContentHash } from "../src/content-names.ts";
import { watch } from "../src/watch.ts";
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
