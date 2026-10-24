// Typed keys: what type checking a file of 500 message calls costs, against grai's generated
// declarations and against i18next's keys, typed by declaration merging over the locale's JSON
// (`CustomTypeOptions`). `tsc --noEmit` with TypeScript 7, median of three, and the editor's
// completion after `m.` and inside `t("`, from TypeScript 6's language service, which tsserver
// runs: the first request, which checks the program, and the next.
//   node types.mjs [app...]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { selectedApps } from "./apps.mjs";
import { sampleCalls } from "./calls.mjs";
import { graiSource, writeGraiProject } from "./grai.mjs";
import { i18nextValues, libraryCatalogs } from "./libraries.mjs";
import { otherLocale } from "./request.mjs";

const CALLS = 500;
const require = createRequire(import.meta.url);
const ts6 = require("typescript6");
const tsc7 = join(
	new URL(".", import.meta.url).pathname,
	"node_modules/.bin/tsc",
);

const compilerOptions = {
	target: "es2024",
	module: "nodenext",
	strict: true,
	noEmit: true,
	skipLibCheck: true,
	resolveJsonModule: true,
};

/** Writes the two projects: each a tsconfig, its declarations and a file of 500 calls. */
async function writeProjects(app) {
	const config = writeGraiProject(app, "types");
	const directory = join(config, "..");
	const { compile } = await import(join(graiSource, "index.ts"));
	await compile(config);
	const locale = otherLocale(app);
	writeFileSync(
		join(directory, "translation.json"),
		JSON.stringify(libraryCatalogs(app, locale).i18next),
	);
	writeFileSync(
		join(directory, "i18next.d.ts"),
		`import "i18next";
import type translation from "./translation.json" with { type: "json" };
declare module "i18next" {
	interface CustomTypeOptions {
		resources: { translation: typeof translation };
	}
}
`,
	);
	const calls = sampleCalls(app, CALLS);
	const literal = (values) => JSON.stringify(values);
	writeFileSync(
		join(directory, "grai.ts"),
		`import { m } from "./out/messages.js";\nexport const texts = [\n${calls.map((call) => `\tm.${call.key}(${call.kind === "text" ? "" : literal(call.inputs)}),`).join("\n")}\n];\n`,
	);
	writeFileSync(
		join(directory, "i18next.ts"),
		`import i18next from "i18next";\nconst t = i18next.t;\nexport const texts = [\n${calls.map((call) => `\tt(${JSON.stringify(call.key)}${call.kind === "text" ? "" : `, ${literal(i18nextValues(app, call.key, call.inputs))}`}),`).join("\n")}\n];\n`,
	);
	for (const name of ["grai", "i18next"]) {
		const files =
			name === "grai" ? ["grai.ts"] : ["i18next.d.ts", "i18next.ts"];
		writeFileSync(
			join(directory, `tsconfig.${name}.json`),
			JSON.stringify({ compilerOptions, files }),
		);
	}
	return directory;
}

/** Milliseconds to the first completion at `marker` appended to `file`, and to the next one. */
function completion(directory, file, marker) {
	const path = join(directory, file);
	const text = `${readFileSync(path, "utf8")}${marker}`;
	const names = JSON.parse(
		readFileSync(
			join(directory, `tsconfig.${file.replace(".ts", "")}.json`),
			"utf8",
		),
	).files.map((name) => join(directory, name));
	const host = {
		getScriptFileNames: () => names,
		getScriptVersion: () => "1",
		getScriptSnapshot: (name) =>
			ts6.ScriptSnapshot.fromString(
				name === path ? text : (ts6.sys.readFile(name) ?? ""),
			),
		getCurrentDirectory: () => directory,
		getCompilationSettings: () => ({
			...ts6.convertCompilerOptionsFromJson(compilerOptions, directory).options,
		}),
		getDefaultLibFileName: ts6.getDefaultLibFilePath,
		fileExists: ts6.sys.fileExists,
		readFile: ts6.sys.readFile,
		readDirectory: ts6.sys.readDirectory,
		directoryExists: ts6.sys.directoryExists,
		getDirectories: ts6.sys.getDirectories,
	};
	const service = ts6.createLanguageService(host, ts6.createDocumentRegistry());
	const at = (start) => {
		const result = service.getCompletionsAtPosition(path, text.length, {});
		return {
			ms: performance.now() - start,
			entries: result?.entries.length ?? 0,
		};
	};
	const first = at(performance.now());
	const next = at(performance.now());
	return { first: first.ms, next: next.ms, entries: first.entries };
}

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

for (const app of selectedApps()) {
	const directory = await writeProjects(app);
	console.log(`\n### ${app.name}: type checking ${CALLS} message calls, ms\n`);
	console.log(
		"| keys typed by | `tsc --noEmit`, TypeScript 7 | first completion, TypeScript 6 | next completion | completions |",
	);
	console.log("|---|---|---|---|---|");
	for (const [name, marker] of [
		["grai", "\nm."],
		["i18next", '\nt("'],
	]) {
		const runs = Array.from({ length: 3 }, () => {
			const start = performance.now();
			execFileSync(tsc7, ["-p", join(directory, `tsconfig.${name}.json`)], {
				stdio: "inherit",
			});
			return performance.now() - start;
		});
		const done = completion(directory, `${name}.ts`, marker);
		console.log(
			`| ${name === "grai" ? "grai's declarations" : "i18next's CustomTypeOptions"} | ${median(runs).toFixed(0)} | ${done.first.toFixed(0)} | ${done.next.toFixed(0)} | ${done.entries} |`,
		);
	}
}
