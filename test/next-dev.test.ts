import { type ChildProcess, spawn } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, onTestFinished } from "vitest";
import { compile } from "../src/index.ts";
import { stopped } from "./stopped.ts";

// `next dev` on a project of the package's own install, from an empty .next: which of the output's
// modules of keys Turbopack compiles in each of its layers for a page.

const repository = fileURLToPath(new URL("..", import.meta.url));
const next = join(repository, "node_modules/.bin/next");

/**
 * A Next project under the repository, so that it resolves next and react from the package's own
 * install, removed after the test. Its catalogs have `count` keys in two locales, each key's words
 * its own; its output is in `i18n/`.
 */
function nextProject(count: number, files: Record<string, string>): string {
	const cache = join(repository, "test/.cache");
	mkdirSync(cache, { recursive: true });
	const dir = mkdtempSync(join(cache, "next-dev-"));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const keys = Array.from({ length: count }, (_, index) => `key${index}`);
	const catalog = (locale: string) =>
		JSON.stringify(
			Object.fromEntries(keys.map((key) => [key, `${locale} ${key}`])),
		);
	const written: Record<string, string> = {
		"package.json": JSON.stringify({ name: "app", type: "module" }),
		"messages/en.json": catalog("en"),
		"messages/de.json": catalog("de"),
		"grai.config.json": JSON.stringify({
			locales: ["en", "de"],
			baseLocale: "en",
			catalogs: "messages/{locale}.json",
			outdir: "i18n",
		}),
		"next.config.mjs": `export default { turbopack: { root: ${JSON.stringify(repository)} } };\n`,
		"app/layout.jsx":
			"export default function Layout({ children }) {\n\treturn <html><body>{children}</body></html>;\n}\n",
		...files,
	};
	for (const [path, text] of Object.entries(written)) {
		mkdirSync(join(dir, path, ".."), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	return dir;
}

/** `next dev` in a project, as the leader of a process group of its own, stopped after the test. */
function nextDev(dir: string): ChildProcess {
	const server = spawn(next, ["dev", "--port", "0"], {
		cwd: dir,
		env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
		detached: true,
	});
	onTestFinished(() => stopped(server));
	return server;
}

/** The URL `next dev` serves once it is ready. */
function servedAt(server: ChildProcess): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const read = (chunk: Buffer) => {
			output += chunk;
			const url = /- Local:\s+(http:\/\/\S+)/.exec(output)?.[1];
			if (url !== undefined && output.includes("Ready")) resolve(url);
		};
		server.stdout?.on("data", read);
		server.stderr?.on("data", read);
		server.on("exit", (code) =>
			reject(new Error(`next dev exited: ${code}\n${output}`)),
		);
	});
}

/**
 * A page's document, and each script it names, as a browser requests them: `next dev` compiles the
 * page's layers for the document and writes the browser's chunks for its scripts.
 */
async function requested(origin: string, path: string): Promise<string> {
	const response = await fetch(`${origin}${path}`);
	const html = await response.text();
	expect(response.status, html).toBe(200);
	const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(
		([, src]) => src,
	);
	for (const src of scripts)
		await (await fetch(new URL(src ?? "", origin))).text();
	return html;
}

/** The output's modules of keys `next dev` compiled for each layer, read from the chunks it wrote. */
function compiledKeys(dir: string): Record<string, string[]> {
	const layers: Record<string, Set<string>> = {};
	const built = join(dir, ".next/dev");
	for (const name of readdirSync(built, {
		recursive: true,
		encoding: "utf8",
	})) {
		if (!name.endsWith(".js")) continue;
		const code = readFileSync(join(built, name), "utf8");
		for (const [, module, layer] of code.matchAll(
			/\/i18n\/(keys\/[^ "]+\.js) \[([a-z-]+)\] \(ecmascript\)", \(\(__turbopack_context__\)/g,
		)) {
			if (module === undefined || layer === undefined) continue;
			layers[layer] ??= new Set();
			layers[layer].add(module);
		}
	}
	return Object.fromEntries(
		Object.entries(layers).map(([layer, modules]) => [
			layer,
			[...modules].sort(),
		]),
	);
}

/** The output's module of keys that holds a key's words. */
function moduleOf(dir: string, words: string): string {
	const keys = join(dir, "i18n/keys");
	const name = readdirSync(keys).find(
		(file) =>
			file.endsWith(".js") &&
			readFileSync(join(keys, file), "utf8").includes(JSON.stringify(words)),
	);
	if (name === undefined) throw new Error(`no module of keys holds ${words}`);
	return `keys/${name}`;
}

it("compiles, in each layer, only the modules of the keys that layer's components read", {
	timeout: 120_000,
}, async () => {
	const dir = nextProject(1200, {
		"app/page.jsx": `import * as m from "../i18n/keys.js";
import { Client } from "./client.jsx";

export default function Page() {
	return <main><p>{m.key7({}, { locale: "de" })}</p><Client /></main>;
}
`,
		"app/client.jsx": `"use client";
import * as m from "../i18n/keys.js";

export function Client() {
	return <p>{m.key900({}, { locale: "de" })}</p>;
}
`,
	});
	expect((await compile(join(dir, "grai.config.json"))).errors).toEqual([]);
	const server = moduleOf(dir, "de key7");
	const client = moduleOf(dir, "de key900");
	expect(server).not.toBe(client);

	const html = await requested(await servedAt(nextDev(dir)), "/");

	expect(html).toContain("de key7");
	expect(html).toContain("de key900");
	expect(compiledKeys(dir)).toEqual({
		"app-rsc": [server],
		"app-ssr": [client],
		"app-client": [client],
	});
});
