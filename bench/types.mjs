// Typed keys: what type checking a file of 500 message calls costs with each library's typed
// keys: grai's and Paraglide's generated declarations, i18next's keys merged into its types from
// the locale's JSON (`CustomTypeOptions`), and use-intl's, inferred from the messages it is
// given. `tsc --noEmit` with TypeScript 7, median of three, and the editor's completion after
// `m.` or inside `t("`, from TypeScript 6's language service, which tsserver runs: the first
// request, which checks the program, and the next, each a median of three new language services.
//   node types.mjs [app...]
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { selectedApps } from "./apps.mjs";
import { sampleCalls, takesInputs } from "./calls.mjs";
import { graiSource, writeGraiProject } from "./grai.mjs";
import { i18nextValues, libraryCatalogs } from "./libraries.mjs";
import { paraglideOutput, resolveTypeScript6 } from "./paraglide.mjs";
import { otherLocale } from "./request.mjs";
import { recordResults } from "./results.mjs";

const CALLS = 500;
const RUNS = 3;
const require = createRequire(import.meta.url);
const ts6 = require("typescript6");
const tsc7 = join(
	new URL(".", import.meta.url).pathname,
	"node_modules/.bin/tsc",
);

/** TypeScript 7's version, as its tsc prints it. */
const ts7Version = () =>
	execFileSync(tsc7, ["--version"], { encoding: "utf8" })
		.trim()
		.split(" ")
		.at(-1);

const compilerOptions = {
	target: "es2024",
	module: "nodenext",
	strict: true,
	noEmit: true,
	skipLibCheck: true,
	resolveJsonModule: true,
};

/**
 * Each library's project: its files (the declarations it needs and a file of 500 calls) and the
 * text after which the editor is asked to complete a key.
 */
async function writeProjects(app) {
	const config = writeGraiProject(app, "types");
	const directory = join(config, "..");
	const { compile } = await import(join(graiSource, "index.ts"));
	await compile(config);
	resolveTypeScript6();
	const paraglide = await paraglideOutput(app, { emitTsDeclarations: true });
	const locale = otherLocale(app);
	const { i18next, icu } = libraryCatalogs(app, locale);
	writeFileSync(join(directory, "translation.json"), JSON.stringify(i18next));
	writeFileSync(join(directory, "messages.json"), JSON.stringify(icu));
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
	const values = (call, given = call.inputs) =>
		takesInputs(call) ? JSON.stringify(given) : "";
	const keyCalls = (write) =>
		calls.map((call) => `\t${write(call)},`).join("\n");
	const sources = {
		grai: `import { m } from "./out/messages.js";\nexport const texts = [\n${keyCalls((call) => `m.${call.key}(${values(call)})`)}\n];\n`,
		paraglide: `import { m } from "./${relative(directory, join(paraglide, "messages.js"))}";\nexport const texts = [\n${keyCalls((call) => `m.${call.key}(${values(call)})`)}\n];\n`,
		i18next: `import i18next from "i18next";\nconst t = i18next.t;\nexport const texts = [\n${keyCalls((call) => `t(${JSON.stringify(call.key)}${takesInputs(call) ? `, ${values(call, i18nextValues(app, call.key, call.inputs))}` : ""})`)}\n];\n`,
		"use-intl": `import { createTranslator } from "use-intl/core";\nimport messages from "./messages.json" with { type: "json" };\nconst t = createTranslator({ locale: ${JSON.stringify(locale)}, messages });\nexport const texts = [\n${keyCalls((call) => `t(${JSON.stringify(call.key)}${takesInputs(call) ? `, ${values(call)}` : ""})`)}\n];\n`,
	};
	const projects = [
		["grai's declarations", "grai", [], "\nm."],
		["Paraglide's declarations", "paraglide", [], "\nm."],
		["i18next's CustomTypeOptions", "i18next", ["i18next.d.ts"], '\nt("'],
		["use-intl, keys inferred from the messages", "use-intl", [], '\nt("'],
	];
	return projects.map(([title, name, declarations, marker]) => {
		writeFileSync(join(directory, `${name}.ts`), sources[name]);
		const files = [...declarations, `${name}.ts`];
		writeFileSync(
			join(directory, `tsconfig.${name}.json`),
			JSON.stringify({ compilerOptions, files }),
		);
		return {
			title,
			name,
			files: files.map((file) => join(directory, file)),
			marker,
			directory,
		};
	});
}

/** Milliseconds to the first completion at the project's marker, appended to its calls, and to the next one. */
function completion({ name, files, marker, directory }) {
	const path = join(directory, `${name}.ts`);
	const text = `${readFileSync(path, "utf8")}${marker}`;
	const host = {
		getScriptFileNames: () => files,
		getScriptVersion: () => "1",
		getScriptSnapshot: (file) =>
			ts6.ScriptSnapshot.fromString(
				file === path ? text : (ts6.sys.readFile(file) ?? ""),
			),
		getCurrentDirectory: () => directory,
		getCompilationSettings: () =>
			ts6.convertCompilerOptionsFromJson(compilerOptions, directory).options,
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
	const recorded = [];
	const projects = await writeProjects(app);
	console.log(`\n### ${app.name}: type checking ${CALLS} message calls, ms\n`);
	console.log(
		"| keys typed by | `tsc --noEmit`, TypeScript 7 | first completion, TypeScript 6 | next completion | completions |",
	);
	console.log("|---|---|---|---|---|");
	for (const project of projects) {
		const runs = Array.from({ length: RUNS }, () => {
			const start = performance.now();
			execFileSync(
				tsc7,
				["-p", join(project.directory, `tsconfig.${project.name}.json`)],
				{ stdio: "inherit" },
			);
			return performance.now() - start;
		});
		const completions = Array.from({ length: RUNS }, () => completion(project));
		const done = {
			tsc: median(runs),
			first: median(completions.map((each) => each.first)),
			next: median(completions.map((each) => each.next)),
			entries: completions[0].entries,
		};
		console.log(
			`| ${project.title} | ${done.tsc.toFixed(0)} | ${done.first.toFixed(0)} | ${done.next.toFixed(0)} | ${done.entries} |`,
		);
		recorded.push({ library: project.title, ...done });
	}
	recordResults(`types-${app.id}`, recorded, {
		app: app.name,
		calls: CALLS,
		runs: RUNS,
		typescript: { tsc: ts7Version(), languageService: ts6.version },
	});
}
