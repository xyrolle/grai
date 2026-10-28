// What a run of edits leaves held: grai's watcher-style recompile, from this repository's build,
// on a copy of each app's catalogs, its live heap after a full garbage collection once the first
// build is done and again after 400 edits of one message. Each app in a Node process of its own.
//   node edit-memory.mjs [app...]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { selectedApps } from "./apps.mjs";
import { graiModule, writeGraiProject } from "./grai.mjs";

const EDITS = 400;
const self = new URL(import.meta.url).pathname;
const mebibytes = (bytes) => bytes / 2 ** 20;

/** Runs in the child: the first build, then the edits, with the live heap after each. */
async function child(config, catalog, key) {
	const { recompile } = await import(graiModule("compile.ts"));
	const heap = () => {
		globalThis.gc();
		return mebibytes(process.memoryUsage().heapUsed);
	};
	let { build } = await recompile(config, undefined);
	const first = heap();
	const messages = JSON.parse(readFileSync(catalog, "utf8"));
	for (let edit = 1; edit <= EDITS; edit++) {
		writeFileSync(
			catalog,
			JSON.stringify({ ...messages, [key]: `Edit ${edit}` }, null, "\t"),
		);
		({ build } = await recompile(config, build));
	}
	console.log(JSON.stringify({ first, edited: heap() }));
}

if (process.argv[2] === "--child") {
	await child(...process.argv.slice(3));
} else {
	console.log(
		`| app | live heap after the first build | after ${EDITS} edits |`,
	);
	console.log("| --- | --- | --- |");
	for (const app of selectedApps()) {
		const config = writeGraiProject(app, "edit-memory");
		const locale = app.baseLocale;
		const key = Object.keys(app.messages[locale]).find(
			(name) => typeof app.messages[locale][name] === "string",
		);
		const catalog = join(config, "..", "messages", `${locale}.json`);
		const { first, edited } = JSON.parse(
			execFileSync(
				process.execPath,
				["--expose-gc", self, "--child", config, catalog, key],
				{ encoding: "utf8" },
			)
				.trim()
				.split("\n")
				.at(-1),
		);
		console.log(
			`| ${app.id} | ${first.toFixed(1)} MiB | ${edited.toFixed(1)} MiB |`,
		);
	}
}
