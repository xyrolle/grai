// One sample of the editor's completions (completions.mjs) through TypeScript 7's language server,
// `tsc --lsp --stdio`, which editors run from TypeScript 7 on, in a new process. It is started and
// initialized before the sample, as an editor starts it when a folder opens; the editor then opens
// the file, sends each edit whole, and reports the files the catalog's tool wrote, as its watcher
// would. The server's preferences are its defaults, the same for every library. Prints the
// sample's milliseconds as JSON.
//   node completion-ts7.mjs <description>
import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { sample } from "./completions.mjs";
import { startServer } from "./lsp.mjs";

const tsc = new URL("node_modules/.bin/tsc", import.meta.url).pathname;

/** How LSP numbers a watched file's change. */
const fileChange = { created: 1, changed: 2, deleted: 3 };

const capabilities = {
	textDocument: {
		completion: {
			contextSupport: true,
			completionItem: {
				snippetSupport: true,
				insertReplaceSupport: true,
				labelDetailsSupport: true,
				resolveSupport: { properties: ["detail", "documentation"] },
			},
		},
	},
	workspace: {
		configuration: true,
		didChangeWatchedFiles: {
			dynamicRegistration: true,
			relativePatternSupport: true,
		},
	},
};

/** The line and character of an offset in a text, as LSP counts them. */
function position(text, offset) {
	const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
	const line = text.slice(0, lineStart).split("\n").length - 1;
	return { line, character: offset - lineStart };
}

/** TypeScript 7's language server on the project of the file it opens. */
function languageServer() {
	let server;
	let document;
	let first;
	return {
		async prepare(path) {
			const folder = pathToFileURL(dirname(path)).href;
			server = startServer(tsc, ["--lsp", "--stdio"], { cwd: dirname(path) });
			await server.request("initialize", {
				processId: process.pid,
				rootUri: folder,
				workspaceFolders: [{ uri: folder, name: "project" }],
				capabilities,
			});
			server.notify("initialized", {});
			document = { uri: pathToFileURL(path).href, version: 0, text: "" };
		},
		open(text) {
			document.text = text;
			server.notify("textDocument/didOpen", {
				textDocument: { ...document, languageId: "typescript", version: 1 },
			});
			document.version = 1;
		},
		change(text) {
			document.text = text;
			document.version++;
			server.notify("textDocument/didChange", {
				textDocument: { uri: document.uri, version: document.version },
				contentChanges: [{ text }],
			});
		},
		changed(changes) {
			server.notify("workspace/didChangeWatchedFiles", {
				changes: Object.entries(changes).flatMap(([kind, paths]) =>
					paths.map((path) => ({
						uri: pathToFileURL(path).href,
						type: fileChange[kind],
					})),
				),
			});
		},
		async complete(offset, trigger) {
			const list = await server.request("textDocument/completion", {
				textDocument: { uri: document.uri },
				position: position(document.text, offset),
				context:
					trigger === undefined
						? { triggerKind: 1 }
						: { triggerKind: 2, triggerCharacter: trigger },
			});
			const items = Array.isArray(list) ? list : (list?.items ?? []);
			first = items[0];
			return items.map((item) => item.label);
		},
		async details() {
			const item = await server.request("completionItem/resolve", first);
			return item.detail ?? item.documentation?.value;
		},
		async stop() {
			await server.request("shutdown");
			server.notify("exit");
			server.stop();
		},
	};
}

const version = execFileSync(tsc, ["--version"], { encoding: "utf8" })
	.trim()
	.split(" ")
	.at(-1);
const times = await sample(process.argv[2], languageServer());
console.log(JSON.stringify({ ...times, typescript: version }));
