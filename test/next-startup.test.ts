import { readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import type { CompileResult } from "../src/compile.ts";
import { type FirstGroups, firstGroups } from "../src/next/first-groups.ts";
import { started } from "../src/next/startup.ts";
import type { KeyGroups } from "../src/saved-groups.ts";
import { groupsFile } from "../src/saved-groups.ts";
import { watch } from "../src/watch.ts";
import { freshApp } from "./next-fresh-app.ts";

// When a fresh `next dev` start may go on (`startup.ts`): once its first compile has ended, with the
// keys placed by the groups read beside it when they come in time. No other compile releases it.

/** A read of the groups whose answer the test gives, once the start has asked for it. */
function heldRead() {
	let asked: () => void = () => {};
	const asking = new Promise<void>((resolve) => {
		asked = resolve;
	});
	let answer: (groups: KeyGroups) => void = () => {};
	const answered = new Promise<KeyGroups>((resolve) => {
		answer = resolve;
	});
	const stops: string[] = [];
	const reading: FirstGroups = {
		read: Promise.resolve(true),
		after: () => {
			asked();
			return answered;
		},
		stop: async () => {
			stops.push("stopped");
		},
	};
	return { reading, asking, answer, stops };
}

/** A watch of the app whose reports the test reads, and waits for one by one; closed after it. */
function watched(config: string) {
	const reports: CompileResult[] = [];
	let reported: () => void = () => {};
	const watching = watch(
		config,
		(result) => {
			reports.push(result);
			reported();
		},
		(error) => {
			throw error;
		},
	);
	onTestFinished(() => watching.close());
	const nextReport = () =>
		new Promise<void>((resolve) => {
			reported = resolve;
		});
	return { watching, reports, nextReport };
}

const groupModules = (dir: string) =>
	readdirSync(join(dir, "out", "keys")).filter((name) =>
		/^g\d+-.*\.js$/.test(name),
	);

it("starts Next only once the keys are placed by the groups, though an edit compiles while they are read", async () => {
	const { dir, config } = freshApp();
	const { watching, reports, nextReport } = watched(config);
	const held = heldRead();
	let released = false;
	const release = started(watching, held.reading).then((start) => {
		released = true;
		return start;
	});

	await held.asking;
	const edited = nextReport();
	writeFileSync(
		join(dir, "messages", "en.json"),
		JSON.stringify({ about: "About us", home: "Home", unread: "Unread" }),
	);
	await edited;
	expect(released).toBe(false);

	held.answer([["about"], ["home"]]);
	const { grouped, compiled } = await release;
	expect(grouped).toBe(true);
	expect(held.stops).toEqual(["stopped"]);
	expect(groupModules(dir)).toHaveLength(2);
	expect("build" in compiled && compiled.build?.rendered.groups).toBe(
		JSON.stringify([["about"], ["home"]]),
	);
	// Nothing is written for the groups once Next has started.
	const count = reports.length;
	await watching.close();
	expect(reports).toHaveLength(count);
});

it("starts Next only once the compile that places the keys has read a catalog met mid-save again", async () => {
	const { dir, config } = freshApp();
	const { watching, reports } = watched(config);
	const held = heldRead();
	const release = started(watching, held.reading);

	await held.asking;
	// The catalog stays broken: the compile reads it again once the files are quiet, and that stands.
	writeFileSync(join(dir, "messages", "en.json"), '{ "about": "Abo');
	held.answer([["about"], ["home"]]);
	const { compiled } = await release;

	expect(
		"result" in compiled && compiled.result.errors.map(({ code }) => code),
	).toEqual(["catalog-invalid"]);
	expect(reports.at(-1)?.errors.map(({ code }) => code)).toEqual([
		"catalog-invalid",
	]);
});

it("places the keys by the groups before Next starts, when a catalog mid-save is mended while the compile waits to read it again", async () => {
	const { dir, config } = freshApp();
	const { watching } = watched(config);
	const held = heldRead();
	const catalog = join(dir, "messages", "en.json");
	const release = started(watching, held.reading);

	await held.asking;
	writeFileSync(catalog, '{ "about": "Abo');
	held.answer([["about"], ["home"]]);
	// Events keep coming while the save goes on, which holds the read again back; then it ends whole.
	const touched = setInterval(
		() => utimesSync(catalog, new Date(), new Date()),
		5,
	);
	onTestFinished(() => clearInterval(touched));
	await expect
		.poll(() => readFileSync(groupsFile(join(dir, "out")), "utf8"))
		.toContain("about");
	writeFileSync(
		catalog,
		JSON.stringify({ about: "About", home: "Home", unread: "Unread" }),
	);
	clearInterval(touched);
	const { compiled } = await release;

	expect("result" in compiled && compiled.result.errors).toEqual([]);
	expect(groupModules(dir)).toHaveLength(2);
});

it("starts Next on its first compile, and stops the read, when the code was not read by then", async () => {
	const { dir, config } = freshApp();
	const { watching } = watched(config);
	const stops: string[] = [];
	const reading: FirstGroups = {
		read: Promise.resolve(false),
		after: async () => undefined,
		stop: async () => {
			stops.push("stopped");
		},
	};

	const { grouped } = await started(watching, reading);

	expect(grouped).toBe(false);
	expect(stops).toEqual(["stopped"]);
	expect(groupModules(dir)).toEqual([]);
});

it("places a fresh app's keys by the groups its code's read gives, once that read is done before the first compile is", async () => {
	// Catalogs large enough that their compile, the time the groups have to come in, far outlasts
	// the second read of the app's few files.
	const { dir, config, data } = freshApp(20_000);
	const reading = firstGroups(data);
	expect(await reading.read).toBe(true);
	const { watching } = watched(config);

	const { grouped } = await started(watching, reading);

	expect(grouped).toBe(true);
	expect(
		JSON.parse(readFileSync(groupsFile(join(dir, "out")), "utf8")),
	).toEqual([["about"], ["home"]]);
	expect(groupModules(dir)).toHaveLength(2);
});
