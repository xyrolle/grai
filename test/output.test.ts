import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { expect, it, vi } from "vitest";
import { project } from "./project.ts";

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}" },
	de: { title: "Titel", greeting: "Hallo {name}" },
};

function modified(dir: string): Record<string, number> {
	const out = join(dir, "out");
	return Object.fromEntries(
		readdirSync(out).map((file) => [file, statSync(join(out, file)).mtimeMs]),
	);
}

it("writes the whole output once, then only the files an edit changes", async () => {
	const { dir, compile } = project(catalogs);
	expect((await compile()).written).toEqual([
		"config.js",
		"runtime.d.ts",
		"runtime.js",
		"keys/0.d.ts",
		"keys/0.js",
		"keys.d.ts",
		"keys.js",
		"messages.d.ts",
		"messages.js",
	]);

	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogs.de, title: "Überschrift" }),
	);
	expect((await compile()).written).toEqual(["keys/0.js"]);
});

it("touches nothing when the catalogs and config are those of the output", async () => {
	const { dir, compile } = project(catalogs);
	await compile();
	const before = modified(dir);

	expect((await compile()).written).toEqual([]);
	expect(modified(dir)).toEqual(before);
});

it("writes a file of the output again when it is missing", async () => {
	const { dir, compile } = project(catalogs);
	await compile();
	rmSync(join(dir, "out", "keys.js"));

	expect((await compile()).written).toEqual(["keys.js"]);
});

it("takes over the lock of a writer that is gone", async () => {
	const { dir, compile } = project(catalogs);
	const gone = spawnSync(process.execPath, ["-e", ""]).pid;
	mkdirSync(join(dir, "out", ".grai"), { recursive: true });
	writeFileSync(join(dir, "out", ".grai", "lock"), String(gone));

	expect((await compile()).errors).toEqual([]);
	expect(existsSync(join(dir, "out", ".grai", "lock"))).toBe(false);
});

it("waits for a live writer's lock before it writes", async () => {
	const { dir, compile } = project(catalogs);
	const state = join(dir, "out", ".grai");
	mkdirSync(state, { recursive: true });
	writeFileSync(join(state, "lock"), String(process.pid));

	const compiling = compile();
	await vi.waitFor(() =>
		expect(existsSync(join(state, `lock.${process.pid}`))).toBe(true),
	);
	expect(existsSync(join(dir, "out", "keys.js"))).toBe(false);
	rmSync(join(state, "lock"));

	expect((await compiling).written).toContain("keys.js");
});

it("writes output whose every import is a file of the output", async () => {
	const { dir, compile } = project(catalogs);
	await compile();
	const out = join(dir, "out");
	const imports = readdirSync(out, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".js"))
		.flatMap((file) =>
			[
				...readFileSync(join(out, file), "utf8").matchAll(/from "([^"]+)"/g),
			].map(([, specifier = ""]) => resolve(out, dirname(file), specifier)),
		);

	expect(imports.length).toBeGreaterThan(0);
	for (const path of imports) {
		expect(path.startsWith(`${out}/`) && existsSync(path)).toBe(true);
	}
});
