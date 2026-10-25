// The startup bench in workerd: a module loaded in a new workerd, which Wrangler starts for each
// measurement, timed inside it by startup-worker.js. Modules go to workerd as they are, unbundled,
// so the module under test is compiled when the worker imports it.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { unstable_startWorker } from "wrangler";
import { cacheDir } from "./apps.mjs";

const here = new URL(".", import.meta.url).pathname;

/** A worker's files: its entry, the render, the sample as a module, and the module under test. */
export function workerFiles(module, mode, callsFile, locale) {
	const directory = join(cacheDir, "startup-workerd", basename(module, ".mjs"));
	mkdirSync(directory, { recursive: true });
	for (const file of ["startup-worker.js", "startup-render.mjs"])
		copyFileSync(join(here, file), join(directory, file));
	copyFileSync(module, join(directory, "module.mjs"));
	writeFileSync(
		join(directory, "calls.js"),
		`export default ${readFileSync(callsFile, "utf8")};\n`,
	);
	writeFileSync(
		join(directory, "settings.js"),
		`export const mode = ${JSON.stringify(mode)};\nexport const locale = ${JSON.stringify(locale)};\n`,
	);
	return directory;
}

/**
 * Starts a new workerd on a worker's directory, its modules as they are, and answers its first
 * request: the times its entry reports. The entry is startup-worker.js unless named.
 */
export async function inWorkerd(directory, entry = "startup-worker.js") {
	const worker = await unstable_startWorker({
		name: "grai-startup",
		entrypoint: join(directory, entry),
		compatibilityDate: "2026-10-01",
		compatibilityFlags: ["nodejs_compat", "new_module_registry"],
		build: {
			bundle: false,
			moduleRules: [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }],
		},
		dev: { server: { port: 0 }, inspector: false, logLevel: "none" },
	});
	try {
		return await (await worker.fetch("http://bench/")).json();
	} finally {
		await worker.dispose();
	}
}
