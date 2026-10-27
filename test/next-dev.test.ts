import { type ChildProcess, spawn } from "node:child_process";
import {
	existsSync,
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

// `next dev` on a project of the package's own install: which of the output's modules of keys
// Turbopack compiles in each of its layers for a page, and the groups of keys withGrai's watch saves
// from the app's routes for the next start.

const repository = fileURLToPath(new URL("..", import.meta.url));
const next = join(repository, "node_modules/.bin/next");

/**
 * A Next project under the repository, so that it resolves next and react from the package's own
 * install, removed after the test. Its catalogs have `count` keys in two locales, each key's words
 * its own; its output is in `i18n/`. With `withGrai`, its config takes withGrai from the package's
 * source, which compiles and watches the catalogs for `next dev`.
 */
function nextProject(
	count: number,
	files: Record<string, string>,
	{ withGrai = false }: { withGrai?: boolean } = {},
): string {
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
		"next.config.mjs": withGrai
			? `import { withGrai } from ${JSON.stringify(join(repository, "src/next/config.ts"))};\nexport default withGrai({ turbopack: { root: ${JSON.stringify(repository)} } });\n`
			: `export default { turbopack: { root: ${JSON.stringify(repository)} } };\n`,
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

/** The output's module of keys that holds a key's words, among those keys.js re-exports. */
function moduleOf(dir: string, words: string): string {
	const out = join(dir, "i18n");
	const modules = [
		...readFileSync(join(out, "keys.js"), "utf8").matchAll(
			/"\.\/(keys\/[^"]+)"/g,
		),
	].map(([, module]) => module ?? "");
	const module = modules.find((each) =>
		readFileSync(join(out, each), "utf8").includes(JSON.stringify(words)),
	);
	if (module === undefined) throw new Error(`no module of keys holds ${words}`);
	return module;
}

/** `next dev` started in a project, once it serves. */
async function started(
	dir: string,
): Promise<{ server: ChildProcess; origin: string }> {
	const server = nextDev(dir);
	return { server, origin: await servedAt(server) };
}

/** The groups withGrai's watch saved, once `saved` takes them, polled for at most a minute. */
async function savedGroups(
	dir: string,
	saved: (groups: string[][]) => boolean,
): Promise<string[][]> {
	const file = join(dir, "i18n/.grai/groups.json");
	const deadline = performance.now() + 60_000;
	while (performance.now() < deadline) {
		const groups: string[][] | undefined = existsSync(file)
			? JSON.parse(readFileSync(file, "utf8"))
			: undefined;
		if (groups !== undefined && saved(groups)) return groups;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(
		`the watch saved no such groups in a minute: ${existsSync(file) ? readFileSync(file, "utf8") : "none"}`,
	);
}

/** A home page that reads `server` keys in its server component and `client` keys in a client one. */
const homePage = (server: readonly string[], client: readonly string[]) => ({
	"app/page.jsx": `import * as m from "../i18n/keys.js";
import { Client } from "./client.jsx";

export default function Page() {
	return <main>${server.map((key) => `<p>{m.${key}({}, { locale: "de" })}</p>`).join("")}<Client /></main>;
}
`,
	"app/client.jsx": `"use client";
import * as m from "../i18n/keys.js";

export function Client() {
	return <div>${client.map((key) => `<p>{m.${key}({}, { locale: "de" })}</p>`).join("")}</div>;
}
`,
});

/** Writes a project's files again, as an edit saves them. */
function edited(dir: string, files: Record<string, string>): void {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(join(dir, path, ".."), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
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

it("saves the groups each route's side reads once next dev is quiet, and the next start compiles each layer's group alone", {
	timeout: 180_000,
}, async () => {
	const dir = nextProject(1200, homePage(["key7"], ["key900"]), {
		withGrai: true,
	});
	const first = await started(dir);
	await requested(first.origin, "/");

	expect(await savedGroups(dir, (groups) => groups.length > 0)).toEqual([
		["key7"],
		["key900"],
	]);
	await stopped(first.server);

	rmSync(join(dir, ".next"), { recursive: true, force: true });
	const html = await requested((await started(dir)).origin, "/");

	expect(html).toContain("de key7");
	expect(html).toContain("de key900");
	const server = moduleOf(dir, "de key7");
	const client = moduleOf(dir, "de key900");
	expect([server, client]).toEqual([
		expect.stringMatching(/^keys\/g0-/),
		expect.stringMatching(/^keys\/g1-/),
	]);
	expect(compiledKeys(dir)).toEqual({
		"app-rsc": [server],
		"app-ssr": [client],
		"app-client": [client],
	});
});

it("renders a key a component reads after the groups were saved, groups it at the next start, and groups again as routes come and go", {
	timeout: 300_000,
}, async () => {
	const dir = nextProject(1200, homePage(["key7"], ["key900"]), {
		withGrai: true,
	});
	const first = await started(dir);
	await requested(first.origin, "/");
	await savedGroups(dir, (groups) => groups.length > 0);
	await stopped(first.server);

	// A key the client component reads now, which its group does not hold: its shard serves it.
	edited(dir, homePage(["key7"], ["key900", "key901"]));
	const second = await started(dir);
	expect(await requested(second.origin, "/")).toContain("de key901");
	expect(
		await savedGroups(dir, (groups) => groups.flat().includes("key901")),
	).toEqual([["key7"], ["key900", "key901"]]);
	await stopped(second.server);

	rmSync(join(dir, ".next"), { recursive: true, force: true });
	const third = await started(dir);
	expect(await requested(third.origin, "/")).toContain("de key901");
	const client = moduleOf(dir, "de key901");
	expect(client).toBe(moduleOf(dir, "de key900"));
	expect(compiledKeys(dir)["app-ssr"]).toEqual([client]);
	await stopped(third.server);

	// A route added: its keys are grouped at the start after the one that served it.
	edited(dir, {
		"app/about/page.jsx": `import * as m from "../../i18n/keys.js";

export default function About() {
	return <main>{m.key55({}, { locale: "de" })}</main>;
}
`,
	});
	const fourth = await started(dir);
	expect(await requested(fourth.origin, "/about")).toContain("de key55");
	expect(
		await savedGroups(dir, (groups) => groups.flat().includes("key55")),
	).toEqual([["key55"], ["key7"], ["key900", "key901"]]);
	await stopped(fourth.server);

	// The route removed: its keys leave the groups, for their shards.
	rmSync(join(dir, "app/about"), { recursive: true, force: true });
	const fifth = await started(dir);
	expect(await requested(fifth.origin, "/")).toContain("de key7");
	expect(
		await savedGroups(dir, (groups) => !groups.flat().includes("key55")),
	).toEqual([["key7"], ["key900", "key901"]]);
	await stopped(fifth.server);
});

it("places the keys by the groups saved in the running server at its next catalog edit, and renders the edit", {
	timeout: 180_000,
}, async () => {
	const dir = nextProject(1200, homePage(["key7"], ["key900"]), {
		withGrai: true,
	});
	const { origin } = await started(dir);
	expect(await requested(origin, "/")).toContain("de key7");
	await savedGroups(dir, (groups) => groups.length > 0);
	// Saved, not applied: the running server's output is still shards.
	expect(moduleOf(dir, "de key7")).toMatch(/^keys\/\d+-/);

	const catalog = join(dir, "messages/de.json");
	writeFileSync(
		catalog,
		JSON.stringify({
			...JSON.parse(readFileSync(catalog, "utf8")),
			key7: "de key7, edited",
		}),
	);

	const deadline = performance.now() + 60_000;
	let html = "";
	while (!html.includes("de key7, edited") && performance.now() < deadline) {
		html = await (await fetch(`${origin}/`)).text();
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	expect(html).toContain("de key7, edited");
	expect(html).toContain("de key900");
	expect(moduleOf(dir, "de key7, edited")).toMatch(/^keys\/g0-/);
	expect(moduleOf(dir, "de key900")).toMatch(/^keys\/g1-/);
});

it("groups apart the keys two routes take through one barrel, and a re-exported client component's with every route that loads its barrel, as each layer compiles them", {
	timeout: 240_000,
}, async () => {
	const dir = nextProject(
		1200,
		{
			"app/messages.js": 'export { key100, key200 } from "../i18n/keys.js";\n',
			"app/components.js":
				'export { Hello } from "./hello.jsx";\nexport { Bye } from "./bye.jsx";\n',
			"app/hello.jsx": `"use client";
import * as m from "../i18n/keys.js";

export function Hello() {
	return <p>{m.key300({}, { locale: "de" })}</p>;
}
`,
			"app/bye.jsx": `"use client";
import * as m from "../i18n/keys.js";

export function Bye() {
	return <p>{m.key400({}, { locale: "de" })}</p>;
}
`,
			"app/a/page.jsx": `import { key100 } from "../messages.js";
import { Hello } from "../components.js";

export default function A() {
	return <main>{key100({}, { locale: "de" })}<Hello /></main>;
}
`,
			"app/b/page.jsx": `import { key200 } from "../messages.js";
import { Bye } from "../components.js";

export default function B() {
	return <main>{key200({}, { locale: "de" })}<Bye /></main>;
}
`,
		},
		{ withGrai: true },
	);
	const first = await started(dir);
	await requested(first.origin, "/a");
	await requested(first.origin, "/b");
	// The app's own modules keep their side effects, so a route that loads the components' barrel
	// compiles both components, and their keys go together.
	expect(await savedGroups(dir, (groups) => groups.length > 0)).toEqual([
		["key100"],
		["key200"],
		["key300", "key400"],
	]);
	await stopped(first.server);

	for (const [route, server] of [
		["/a", "de key100"],
		["/b", "de key200"],
	] as const) {
		rmSync(join(dir, ".next"), { recursive: true, force: true });
		const { server: running, origin } = await started(dir);
		expect(await requested(origin, route)).toContain(server);
		const client = moduleOf(dir, "de key300");
		expect(moduleOf(dir, "de key400")).toBe(client);
		expect(compiledKeys(dir)).toEqual({
			"app-rsc": [moduleOf(dir, server)],
			"app-ssr": [client],
			"app-client": [client],
		});
		await stopped(running);
	}
});
