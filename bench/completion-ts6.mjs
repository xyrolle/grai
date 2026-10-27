// One sample of the editor's completions (completions.mjs) through TypeScript 6's language
// service, the one tsserver runs, in a new process. Its host versions each file and the project as
// tsserver's does: the open file by the editor's edits, the others by what the watcher reports, and
// the project by any of them, so that a request on a project that has not changed skips
// synchronizing it. It asks as VS Code asks tsserver, with its default preferences, the same for
// every library. Prints the sample's milliseconds as JSON.
//   node completion-ts6.mjs <description>
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { sample } from "./completions.mjs";

const ts = createRequire(import.meta.url)("typescript6");

/** The preferences VS Code gives tsserver's completions by default. */
const preferences = {
	quotePreference: "auto",
	importModuleSpecifierPreference: "shortest",
	importModuleSpecifierEnding: "auto",
	jsxAttributeCompletionStyle: "auto",
	includeCompletionsForModuleExports: true,
	includeCompletionsForImportStatements: true,
	includeCompletionsWithSnippetText: true,
	includeCompletionsWithInsertText: true,
	includeAutomaticOptionalChainCompletions: true,
	includeCompletionsWithClassMemberSnippets: true,
	includeCompletionsWithObjectLiteralMethodSnippets: true,
	useLabelDetailsInCompletionEntries: true,
	allowIncompleteCompletions: true,
	displayPartsForJSDoc: true,
};

/** How a request was triggered, as LSP and tsserver number it: typed character, or invoked. */
const triggerKind = (trigger) => (trigger === undefined ? 1 : 2);

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
	const versions = new Map();
	let projectVersion = 0;
	const touch = (file) => {
		versions.set(file, (versions.get(file) ?? 0) + 1);
		projectVersion++;
	};
	let opened;
	let service;
	let first;
	return {
		open(path, text) {
			const config = parseConfig(dirname(path));
			opened = { path, text };
			touch(path);
			const host = {
				getProjectVersion: () => String(projectVersion),
				getScriptFileNames: () => config.fileNames,
				getScriptVersion: (file) => String(versions.get(file) ?? 0),
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
		change(text) {
			opened.text = text;
			touch(opened.path);
		},
		changed({ created, changed, deleted }) {
			for (const file of [...created, ...changed, ...deleted]) touch(file);
		},
		complete(offset, trigger) {
			const result = service.getCompletionsAtPosition(opened.path, offset, {
				...preferences,
				triggerCharacter: trigger,
				triggerKind: triggerKind(trigger),
			});
			const entries = result?.entries ?? [];
			first = entries[0];
			return entries.map((entry) => entry.name);
		},
		details(offset) {
			const details = service.getCompletionEntryDetails(
				opened.path,
				offset,
				first.name,
				undefined,
				first.source,
				preferences,
				first.data,
			);
			return details && ts.displayPartsToString(details.displayParts);
		},
	};
}

const times = await sample(process.argv[2], languageService());
console.log(JSON.stringify({ ...times, typescript: ts.version }));
