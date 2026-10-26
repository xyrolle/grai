// The startup bench in workerd: a module loaded in a new workerd, which Wrangler starts for each
// measurement, timed inside it by startup-worker.js. Modules go to workerd as they are, unbundled,
// so the module under test is compiled when the worker imports it.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { unstable_startWorker } from "wrangler";
import { cacheDir } from "./apps.mjs";

const here = new URL(".", import.meta.url).pathname;

/** A worker's files: its entry, the sample's values as a module, and the page under test. */
export function workerFiles(module, callsFile, locale) {
	const directory = join(cacheDir, "startup-workerd", basename(module, ".mjs"));
	mkdirSync(directory, { recursive: true });
	copyFileSync(
		join(here, "startup-worker.js"),
		join(directory, "startup-worker.js"),
	);
	copyFileSync(module, join(directory, "module.mjs"));
	const values = JSON.parse(readFileSync(callsFile, "utf8")).map(
		(call) => call.values,
	);
	writeFileSync(
		join(directory, "values.js"),
		`export default ${JSON.stringify(values)};\n`,
	);
	writeFileSync(
		join(directory, "settings.js"),
		`export const locale = ${JSON.stringify(locale)};\n`,
	);
	return directory;
}

/** Loads a worker's module in a new workerd and renders the sample there: the times it reports. */
export async function inWorkerd(directory) {
	const worker = await unstable_startWorker({
		name: "grai-startup",
		entrypoint: join(directory, "startup-worker.js"),
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
