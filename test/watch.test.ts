import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
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
	const watcher = watch(config, (result) => reported.push(result));

	await watcher.close();
	const written = existsSync(join(dir, "out", "messages.js"));
	rmSync(dir, { recursive: true, force: true });

	expect({ written, reported }).toEqual({ written: true, reported: [] });
});
