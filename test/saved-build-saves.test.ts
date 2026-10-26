import { writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { watch } from "../src/watch.ts";
import { project } from "./project.ts";

// The files the saves write, as they name and open them; every write goes on as it would.
vi.mock("node:fs/promises", async (importOriginal) => {
	const fs = await importOriginal<typeof import("node:fs/promises")>();
	return { ...fs, writeFile: vi.fn(fs.writeFile) };
});

const catalogs = {
	en: { title: "Title", cart: "Cart" },
	de: { title: "Titel", cart: "Warenkorb" },
};

it("gives each of two saves at once a file of its own, which it creates, as two watchers of an outdir in one process make them", async () => {
	const { dir, config } = project(catalogs, { pseudoLocale: "en-XA" });
	const watching = async () => {
		const first = Promise.withResolvers<void>();
		const watcher = watch(config, () => first.resolve(), first.reject);
		await first.promise;
		return watcher;
	};
	const before = await watching();
	writeFileSync(
		join(dir, "messages", "en.json"),
		JSON.stringify({ ...catalogs.en, title: "Heading" }, null, "\t"),
	);
	const after = await watching();

	await Promise.all([before.close(), after.close()]);

	const saves = vi
		.mocked(writeFile)
		.mock.calls.filter(([path]) => String(path).endsWith(".saving"));
	expect(saves.map(([, , options]) => options)).toEqual([
		{ flag: "wx" },
		{ flag: "wx" },
	]);
	expect(new Set(saves.map(([path]) => path)).size).toBe(2);
});
