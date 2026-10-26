import {
	existsSync,
	readdirSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import type { CompileResult } from "../src/compile.ts";
import { withoutContentHash } from "../src/content-names.ts";
import { type WatchOptions, watch } from "../src/watch.ts";
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
function watched(config: string, options: WatchOptions = {}) {
	const reported: CompileResult[] = [];
	const failures: unknown[] = [];
	const watcher = watch(
		config,
		(result) => reported.push(result),
		(error) => failures.push(error),
		options,
	);
	onTestFinished(async () => {
		await watcher.close();
		expect(failures).toEqual([]);
	});
	return reported;
}

it("compiles an edit while something else holds the process, when the watch does not", async () => {
	const { dir, config } = project(catalogs);
	const reported = watched(config, { persistent: false });
	await expect.poll(() => reported.length).toBe(1);

	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ title: "Überschrift" }),
	);

	await expect.poll(() => reported.length).toBe(2);
	expect(reported[1]?.errors).toEqual([]);
});

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
