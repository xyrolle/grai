import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import type { CompileResult } from "../src/compile.ts";
import { type FirstGroups, firstGroups } from "../src/next/first-groups.ts";
import { startup } from "../src/next/startup.ts";
import { groupsFile, type KeyGroups } from "../src/saved-groups.ts";
import { watch } from "../src/watch.ts";
import { freshApp } from "./next-fresh-app.ts";

// A fresh `next dev` start whose first compile asks for the groups read beside it (`startup.ts`):
// it places the keys by them in the one output it writes when they come in time, and the start is
// released once that compile has ended and the read has stopped. No other compile releases it.

/**
 * A read of the groups whose answer the test gives, once the compile has asked for it: its code read
 * by then, or still being read.
 */
function heldRead(read = true) {
	let asked: () => void = () => {};
	const asking = new Promise<void>((resolve) => {
		asked = resolve;
	});
	let answer: (groups: KeyGroups | undefined) => void = () => {};
	const answered = new Promise<KeyGroups | undefined>((resolve) => {
		answer = resolve;
	});
	const events: string[] = [];
	const reading: FirstGroups = {
		read: read ? Promise.resolve(true) : new Promise<boolean>(() => {}),
		after: () => {
			events.push("asked");
			asked();
			return answered;
		},
		stop: async () => {
			events.push("stopped");
		},
	};
	return { reading, asking, answer, events };
}

/** The start of a fresh app's watch with this read, its reports, and its release, closed after. */
function started(
	config: string,
	outdir: string,
	reading: FirstGroups,
	held = true,
) {
	const reports: CompileResult[] = [];
	const start = startup(reading, outdir, Promise.resolve(held));
	const watching = watch(
		config,
		(result) => reports.push(result),
		(error) => {
			throw error;
		},
		{ placeFirst: start.placing },
	);
	onTestFinished(() => watching.close());
	return { reports, release: start.released(watching), watching };
}

const groupModules = (dir: string) =>
	readdirSync(join(dir, "out", "keys")).filter((name) =>
		/^g\d+-.*\.js$/.test(name),
	);

it("places the keys by the groups that have come when the first compile asks, in the one output it writes, and releases the start after it", async () => {
	const { dir, config } = freshApp();
	const held = heldRead();
	held.answer([["about"], ["home"]]);
	const { reports, release } = started(config, join(dir, "out"), held.reading);

	const { grouped, compiled } = await release;

	expect(grouped).toBe(true);
	expect(reports).toHaveLength(1);
	expect(held.events).toEqual(["asked", "stopped"]);
	expect(groupModules(dir)).toHaveLength(2);
	expect("build" in compiled && compiled.build?.rendered.groups).toBe(
		JSON.stringify([["about"], ["home"]]),
	);
	expect(
		JSON.parse(readFileSync(groupsFile(join(dir, "out")), "utf8")),
	).toEqual([["about"], ["home"]]);
});

it("writes nothing into an outdir another tool fills, not even the groups it was given, at the start or at an edit after it", async () => {
	const { dir, config } = freshApp();
	const out = join(dir, "out");
	mkdirSync(out);
	writeFileSync(join(out, "notes.md"), "Not grai's\n");
	const held = heldRead();
	held.answer([["about"], ["home"]]);
	const { reports, release } = started(config, out, held.reading);

	const { grouped } = await release;

	const refused = () =>
		reports.map(({ errors }) => errors.map(({ code }) => code));
	expect(grouped).toBe(false);
	expect(refused()).toEqual([["outdir-not-empty"]]);
	expect(readdirSync(out)).toEqual(["notes.md"]);
	const catalog = join(dir, "messages", "en.json");
	writeFileSync(
		catalog,
		JSON.stringify({
			...JSON.parse(readFileSync(catalog, "utf8")),
			added: "Added",
		}),
	);
	await expect.poll(() => reports.length).toBe(2);
	expect(refused()).toEqual([["outdir-not-empty"], ["outdir-not-empty"]]);
	expect(readdirSync(out)).toEqual(["notes.md"]);
});

it("places the keys by their shards, and releases the start without waiting, when the code is still being read and the groups do not come while the first compile renders", async () => {
	const { dir, config } = freshApp();
	const held = heldRead(false);
	const { reports, release } = started(config, join(dir, "out"), held.reading);

	const { grouped } = await release;

	expect(grouped).toBe(false);
	expect(reports).toHaveLength(1);
	expect(held.events).toEqual(["asked", "stopped"]);
	expect(groupModules(dir)).toEqual([]);
});

it("releases the start once a first compile that met a catalog mid-save has read it again, its read stopped and never asked", async () => {
	const { dir, config } = freshApp();
	writeFileSync(join(dir, "messages", "en.json"), '{ "about": "Abo');
	const held = heldRead();
	const { reports, release } = started(config, join(dir, "out"), held.reading);

	const { compiled, grouped } = await release;

	expect(
		"result" in compiled && compiled.result.errors.map(({ code }) => code),
	).toEqual(["catalog-invalid"]);
	expect(reports.map(({ errors }) => errors.map(({ code }) => code))).toEqual([
		["catalog-invalid"],
	]);
	expect({ grouped, events: held.events }).toEqual({
		grouped: false,
		events: ["stopped"],
	});
});

it("places a fresh app's keys by the groups its code's read gives, once that read is done before the catalogs are compiled", async () => {
	// Catalogs large enough that rendering their keys by their shards, the time the groups have to
	// come in, far outlasts grouping the app's few files once the weights come.
	const { dir, config, data } = freshApp(20_000);
	const reading = firstGroups(data);
	expect(await reading.read).toBe(true);

	const { release, reports } = started(config, join(dir, "out"), reading);
	const { grouped } = await release;

	expect(grouped).toBe(true);
	expect(reports).toHaveLength(1);
	expect(
		JSON.parse(readFileSync(groupsFile(join(dir, "out")), "utf8")),
	).toEqual([["about"], ["home"]]);
	expect(groupModules(dir)).toHaveLength(2);
});

it("places the keys by their shards, and stops the read at once, when Next does not wait for the first compile", async () => {
	const { dir, config } = freshApp();
	const held = heldRead();
	held.answer([["about"], ["home"]]);
	const { release } = started(config, join(dir, "out"), held.reading, false);

	const { grouped } = await release;

	expect(grouped).toBe(false);
	expect(held.events).toEqual(["stopped", "stopped"]);
	expect(groupModules(dir)).toEqual([]);
});
