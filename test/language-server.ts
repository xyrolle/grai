import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const tsc = fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));
const source = (file: string) =>
	fileURLToPath(new URL(`../src/${file}`, import.meta.url));

type Position = { line: number; character: number };
type Location = { uri: string; range: { start: Position } };

function isLocation(value: unknown): value is Location {
	return (
		typeof value === "object" &&
		value !== null &&
		"uri" in value &&
		typeof value.uri === "string" &&
		"range" in value &&
		typeof value.range === "object"
	);
}

/** A completion the language server offers: its text, and its kind by the protocol's numbers. */
type Completion = { label: string; kind?: number };
/** The protocol's kind for a keyword, such as `type` among the names of an import. */
const keyword = 14;

function completionsOf(result: unknown): Completion[] {
	const items =
		typeof result === "object" && result !== null && "items" in result
			? result.items
			: result;
	return Array.isArray(items) ? items : [];
}

/**
 * Asks TypeScript's language server, as an editor does, where `m.<key>` in a file is defined:
 * the file and the line and character there, from 0.
 */
export async function definitionOf(
	dir: string,
	key: string,
): Promise<[string, number, number]> {
	const text = `import { m } from "./out/messages.js";\nm.${key}();\n`;
	const result = await askEditor(dir, text, "textDocument/definition", {
		line: 1,
		character: 2,
	});
	const found: unknown = Array.isArray(result) ? result[0] : undefined;
	if (!isLocation(found))
		throw new Error(`no definition: ${JSON.stringify(result)}`);
	return [
		fileURLToPath(found.uri),
		found.range.start.line,
		found.range.start.character,
	];
}

/**
 * The names an editor offers in `import {  } from "<specifier>"`, sorted: every value and type
 * the module's declarations export. `grai` and `grai/…` name the package's own entries.
 */
export async function importableNames(
	dir: string,
	specifier: string,
): Promise<string[]> {
	const text = `import {  } from ${JSON.stringify(specifier)};\n`;
	const result = await askEditor(dir, text, "textDocument/completion", {
		line: 0,
		character: 9,
	});
	return completionsOf(result)
		.filter((completion) => completion.kind !== keyword)
		.map((completion) => completion.label)
		.sort();
}

/**
 * Opens `use.ts`, with the text given, in a project of its own in `dir`, and asks the language
 * server one question about a position in it.
 */
async function askEditor(
	dir: string,
	text: string,
	method: string,
	position: Position,
): Promise<unknown> {
	const file = join(dir, "use.ts");
	writeFileSync(join(dir, "package.json"), '{ "type": "module" }');
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				module: "nodenext",
				strict: true,
				noEmit: true,
				allowImportingTsExtensions: true,
				paths: {
					grai: [source("index.ts")],
					"grai/vite": [source("vite.ts")],
					"grai/svelte": [source("svelte.ts")],
					"grai/sveltekit": [source("sveltekit.ts")],
					"grai/sveltekit/vite": [source("sveltekit-vite.ts")],
					"grai/next": [source("next/render.ts")],
					"grai/next/config": [source("next/config.ts")],
					"grai/next/proxy": [source("next/proxy.ts")],
					"grai/react": [source("react/markup.ts")],
					"grai/astro": [source("astro.ts")],
					"grai/astro/middleware": [source("astro/middleware.ts")],
				},
			},
			files: ["use.ts"],
		}),
	);
	writeFileSync(file, text);
	const server = spawn(tsc, ["--lsp", "--stdio"], { cwd: dir });
	const answers = new Map<number, (result: unknown) => void>();
	let received = Buffer.alloc(0);
	server.stdout.on("data", (chunk: Buffer) => {
		received = Buffer.concat([received, chunk]);
		for (
			let header = received.indexOf("\r\n\r\n");
			header !== -1;
			header = received.indexOf("\r\n\r\n")
		) {
			const length = Number(
				/Content-Length: (\d+)/i.exec(
					received.subarray(0, header).toString(),
				)?.[1],
			);
			if (received.length < header + 4 + length) return;
			const message = JSON.parse(
				received.subarray(header + 4, header + 4 + length).toString(),
			);
			received = received.subarray(header + 4 + length);
			if (message.method !== undefined && message.id !== undefined)
				send({ id: message.id, result: null });
			else answers.get(message.id)?.(message.result);
		}
	});
	const send = (message: object) => {
		const body = JSON.stringify({ jsonrpc: "2.0", ...message });
		server.stdin.write(
			`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
		);
	};
	let next = 0;
	const request = (method: string, params: object) =>
		new Promise<unknown>((resolve) => {
			answers.set(++next, resolve);
			send({ id: next, method, params });
		});
	const uri = pathToFileURL(file).href;
	try {
		await request("initialize", {
			processId: process.pid,
			rootUri: pathToFileURL(dir).href,
			capabilities: {},
		});
		send({ method: "initialized", params: {} });
		send({
			method: "textDocument/didOpen",
			params: {
				textDocument: { uri, languageId: "typescript", version: 1, text },
			},
		});
		return await request(method, { textDocument: { uri }, position });
	} finally {
		server.kill();
	}
}
