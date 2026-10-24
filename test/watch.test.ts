import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import type { CompileResult } from "../src/compile.ts";
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
