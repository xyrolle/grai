// One sample of the editor's completions (completions.mjs) through TypeScript 6's language
// service, the one tsserver runs, in a new process. Its host gives the project a version, as
// tsserver's does, so that a request on a project that has not changed skips synchronizing it.
// Prints the sample's milliseconds as JSON.
//   node completion-ts6.mjs <description>
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { sample } from "./completions.mjs";

const ts = createRequire(import.meta.url)("typescript6");

/** The project's compiler options and root files, from its tsconfig.json. */
function parseConfig(directory) {
	return ts.getParsedCommandLineOfConfigFile(
		join(directory, "tsconfig.json"),
		undefined,
		{
			...ts.sys,
			onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
				throw new Error(
					ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
				);
			},
		},
	);
}

/** A language service on the project of the file it opens, which it reads from the editor. */
function languageService() {
	let opened;
	let service;
	return {
		open(path, text) {
			const config = parseConfig(dirname(path));
			opened = { path, text };
			const host = {
				getProjectVersion: () => "1",
				getScriptFileNames: () => config.fileNames,
				getScriptVersion: () => "1",
				getScriptSnapshot: (file) => {
					const content =
						file === opened.path ? opened.text : ts.sys.readFile(file);
					return content === undefined
						? undefined
						: ts.ScriptSnapshot.fromString(content);
				},
				getCurrentDirectory: () => dirname(path),
				getCompilationSettings: () => config.options,
				getDefaultLibFileName: ts.getDefaultLibFilePath,
				fileExists: ts.sys.fileExists,
				readFile: ts.sys.readFile,
				readDirectory: ts.sys.readDirectory,
				directoryExists: ts.sys.directoryExists,
				getDirectories: ts.sys.getDirectories,
			};
			service = ts.createLanguageService(host, ts.createDocumentRegistry());
		},
		complete(offset) {
			const result = service.getCompletionsAtPosition(opened.path, offset, {});
			return (result?.entries ?? []).map((entry) => entry.name);
		},
	};
}

const times = await sample(process.argv[2], languageService());
console.log(JSON.stringify({ ...times, typescript: ts.version }));
