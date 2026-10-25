import { readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { chromium } from "playwright-core";
import { build, createServer, type PluginOption } from "vite";
import { describe, expect, it, onTestFinished } from "vitest";
import { withoutContentHash } from "../src/content-names.ts";
import { grai } from "../src/svelte.ts";
import { graiModules, grai as graiVite } from "../src/vite.ts";
import { project } from "./project.ts";

const catalogs = {
	en: {
		title: "Title",
		footer: "Footer",
		greeting: "Hello {name}",
		bold: "{#b}Bold{/b}",
		one: "One",
		two: "Two",
		three: "Three",
	},
	de: {
		title: "Titel",
		footer: "Fußzeile",
		greeting: "Hallo {name}",
		bold: "{#b}Fett{/b}",
		one: "Eins",
		two: "Zwei",
		three: "Drei",
	},
};

const nodeModules = fileURLToPath(new URL("../node_modules", import.meta.url));
const withTexts = (): PluginOption[] => [grai(), svelte()];
const withCalls = (): PluginOption[] => [graiVite(), svelte()];
/** grai/svelte's plugin writing each message chunk's copies per locale, for an import map. */
const withCopies = (): PluginOption[] => [
	grai({ localeChunks: true }),
	svelte(),
];

/**
 * A Svelte app in a project: its components, beside an entry that hydrates App.svelte in `#app`
 * and one that renders it on the server in a locale. Its packages are the repository's.
 */
function svelteApp(components: Record<string, string>, config = {}) {
	const { dir } = project(catalogs, config);
	symlinkSync(nodeModules, join(dir, "node_modules"));
	for (const [file, source] of Object.entries(components))
		writeFileSync(join(dir, file), source);
	writeFileSync(
		join(dir, "client.js"),
		`import { hydrate, settled } from "svelte";
import App from "./App.svelte";
const target = document.getElementById("app");
hydrate(App, { target });
await settled();
window.hydrated = { kept: target.firstElementChild === window.drawn, text: target.textContent };
`,
	);
	writeFileSync(
		join(dir, "server.js"),
		`import { render } from "svelte/server";
import { setLocale } from "./out/runtime.js";
import App from "./App.svelte";
export async function page(locale) {
	setLocale(locale);
	return (await render(App)).body;
}
`,
	);
	return dir;
}

/** What a build of the app writes, by file name and as chunks, unminified so a test can read it. */
async function built(
	dir: string,
	plugins: PluginOption[],
	target: "client" | "server",
	write = false,
) {
	const output = await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins,
		ssr: { noExternal: true },
		build: {
			write,
			minify: false,
			outDir: join(dir, target),
			...(target === "server"
				? { ssr: join(dir, "server.js") }
				: { rolldownOptions: { input: { client: join(dir, "client.js") } } }),
		},
	});
	const files = (Array.isArray(output) ? output : [output]).flatMap((result) =>
		"output" in result ? result.output : [],
	);
	return {
		files: new Map(
			files.map((file) => [
				file.fileName,
				file.type === "chunk" ? file.code : String(file.source),
			]),
		),
		chunks: files.filter((file) => file.type === "chunk"),
		entry:
			files.find((file) => file.type === "chunk" && file.isEntry)?.fileName ??
			"",
	};
}

const code = (files: ReadonlyMap<string, string>) =>
	[...files.values()].join("\n");

/**
 * The app built for the server and for the browser, its server's page in each locale hydrated in a
 * browser: whether hydration kept the server's elements, the page's text, and its errors.
 */
async function hydratedPages(
	dir: string,
	plugins: () => PluginOption[],
	locales: readonly string[],
) {
	const rendering = await built(dir, plugins(), "server", true);
	const { entry } = await built(dir, plugins(), "client", true);
	const server = await import(
		pathToFileURL(join(dir, "server", rendering.entry)).href
	);
	const browser = await chromium.launch();
	onTestFinished(() => browser.close());
	const pages = [];
	for (const locale of locales) {
		const body = await server.page(locale);
		const tab = await browser.newPage();
		const errors: string[] = [];
		tab.on("pageerror", (error) => errors.push(String(error)));
		tab.on(
			"console",
			(message) => message.type() === "error" && errors.push(message.text()),
		);
		await tab.route("http://grai.test/**", (route) => {
			const path = new URL(route.request().url()).pathname;
			return path === "/"
				? route.fulfill({
						contentType: "text/html",
						body: `<!doctype html><html lang="${locale}"><script type="importmap">{"imports":{"/assets/grai/":"/assets/grai-${locale}/"}}</script><div id="app">${body}</div><script>window.drawn = document.getElementById("app").firstElementChild;</script><script type="module" src="/${entry}"></script>`,
					})
				: route.fulfill({
						contentType: "text/javascript",
						body: readFileSync(join(dir, "client", path)),
					});
		});
		await tab.goto("http://grai.test/");
		await tab.waitForFunction("window.hydrated !== undefined");
		pages.push({ hydrated: await tab.evaluate("window.hydrated"), errors });
	}
	return pages;
}

describe("grai/svelte's client build", () => {
	it("reads a text message without inputs as its string, and keeps every other call", async () => {
		const dir = svelteApp({
			"App.svelte": `<script>import { m } from "./out/messages.js";</script>
<h1 title={m.footer()}>{m.title()}</h1><p>{m.greeting({ name: "Ana" })}</p>`,
		});
		const { files } = await built(dir, withCopies(), "client");

		expect(code(files)).toContain('pageText("Title", "Titel")');
		expect(code(files)).toContain('pageText("Footer", "Fußzeile")');
		expect(code(files)).not.toContain('text("Title", "Titel")');
		expect(code(files)).toContain("message(");
		const copy = [...files].find(
			([file, source]) =>
				file.startsWith("assets/grai/") && source.includes("pageText"),
		)?.[0];
		expect(
			files.get(copy?.replace("assets/grai/", "assets/grai-de/") ?? ""),
		).toContain('"Titel"');
		expect(
			files.get(copy?.replace("assets/grai/", "assets/grai-de/") ?? ""),
		).not.toContain('"Title"');
	});

	it("names a text key's string module text in graiModules, as the message chunk it went to", async () => {
		const dir = svelteApp({
			"App.svelte": `<script>import { m } from "./out/messages.js";</script>
<h1>{m.title()}</h1><p>{m.greeting({ name: "Ana" })}</p>`,
		});
		const { chunks } = await built(dir, withTexts(), "client");
		const kindOf = graiModules({ config: join(dir, "grai.config.json") });
		const placed = Object.fromEntries(
			chunks.flatMap((chunk) =>
				chunk.moduleIds
					.filter((id) => kindOf(id) !== undefined)
					.map((id) => [
						withoutContentHash(id.replace(`${dir}/`, "")),
						[kindOf(id), chunk.name],
					]),
			),
		);

		expect(placed).toEqual({
			"out/runtime.js": ["runtime", "grai-runtime"],
			"out/config.js": ["config", "grai-runtime"],
			"\0grai:text/title": ["text", "grai~client"],
			"\0grai:key/greeting": ["key", "grai~client"],
		});
	});

	it("follows the key to grai's output through a named import, a module script and an app's re-export", async () => {
		const dir = svelteApp({
			"i18n.js": `export { m } from "./out/messages.js";\n`,
			"App.svelte": `<script module>import { m as messages } from "./i18n.js";</script>
<script>import { two } from "./out/keys.js";</script>
<p>{messages.one()}</p><p>{two()}</p><p>{messages.three()}</p>`,
		});
		const { files } = await built(dir, withTexts(), "client");

		for (const [english, german] of [
			["One", "Eins"],
			["Two", "Zwei"],
			["Three", "Drei"],
		]) {
			expect(code(files)).toContain(`pageText("${english}", "${german}")`);
			expect(code(files)).not.toContain(`text("${english}", "${german}")`);
		}
	});

	it("hydrates the server's page in each locale, keeping its elements", async () => {
		const dir = svelteApp({
			"Label.svelte": `<script>let { text } = $props();</script><span>{text}</span>`,
			"App.svelte": `<script>import { m } from "./out/messages.js"; import Label from "./Label.svelte";</script>
<h1 title={m.footer()}>{m.title()}</h1><Label text={m.title()} /><p>{m.greeting({ name: "Ana" })}</p>`,
		});

		expect(await hydratedPages(dir, withCopies, ["en", "de"])).toEqual([
			{ hydrated: { kept: true, text: "TitleTitleHello Ana" }, errors: [] },
			{ hydrated: { kept: true, text: "TitelTitelHallo Ana" }, errors: [] },
		]);
	});

	it("hydrates an async component's page in place, its texts in markup, a prop and an attribute", async () => {
		// The script calls the namespace after its await, so Svelte's async analysis takes every later
		// read of it as waiting on that await.
		const dir = svelteApp({
			"Label.svelte": `<script>let { text } = $props();</script><span>{text}</span>`,
			"App.svelte": `<script>import { m } from "./out/messages.js"; import Label from "./Label.svelte";
const name = await Promise.resolve("Ana");
const greeting = m.greeting({ name });</script>
<h1 title={m.footer()}>{m.title()}</h1><Label text={m.title()} /><p>{greeting}</p>`,
		});
		const asynchronous = (): PluginOption[] => [
			grai({ localeChunks: true }),
			svelte({ compilerOptions: { experimental: { async: true } } }),
		];

		expect(await hydratedPages(dir, asynchronous, ["en", "de"])).toEqual([
			{ hydrated: { kept: true, text: "TitleTitleHello Ana" }, errors: [] },
			{ hydrated: { kept: true, text: "TitelTitelHallo Ana" }, errors: [] },
		]);
	});

	it("leaves calls with arguments, values, markup and a forced locale as they are", async () => {
		const dir = svelteApp({
			"App.svelte": `<script>import { m } from "./out/messages.js"; const footer = m.footer;</script>
<h1>{m.title({}, { locale: "de" })}</h1><p>{footer()}</p><p>{m.bold()}</p><p>{m.greeting({ name: "Ana" })}</p>`,
		});

		expect(await built(dir, withTexts(), "client")).toEqual(
			await built(dir, withCalls(), "client"),
		);
	});

	it("leaves as it is a component that declares the namespace's name again", async () => {
		const dir = svelteApp({
			"Each.svelte": `<script>import { m } from "./out/messages.js";</script>
<h1>{m.title()}</h1>{#each [{ title: () => "item" }] as m}<p>{m.title()}</p>{/each}`,
			"Index.svelte": `<script>import { m } from "./out/messages.js";</script>
<h1>{m.title()}</h1>{#each [1] as item, m}<p>{item}{m}</p>{/each}`,
			"Snippet.svelte": `<script>import { m } from "./out/messages.js";</script>
{#snippet row(m)}<p>{m.title()}</p>{/snippet}<h1>{m.title()}</h1>{@render row({ title: () => "row" })}`,
			"Script.svelte": `<script>import { m } from "./out/messages.js"; const titleOf = (m) => m.title();</script>
<h1>{m.title()}</h1><p>{titleOf({ title: () => "param" })}</p>`,
			"App.svelte": `<script>import Each from "./Each.svelte"; import Index from "./Index.svelte"; import Snippet from "./Snippet.svelte"; import Script from "./Script.svelte";</script>
<Each /><Index /><Snippet /><Script />`,
		});

		expect(await built(dir, withTexts(), "client")).toEqual(
			await built(dir, withCalls(), "client"),
		);
	});

	it("reads the server's calls as a property, and leaves dev as it is", async () => {
		const dir = svelteApp({
			"App.svelte": `<script>import { m } from "./out/messages.js";</script>\n<h1>{m.title()}</h1>`,
		});
		const served = async (plugins: PluginOption[]) => {
			const server = await createServer({
				root: dir,
				configFile: false,
				logLevel: "silent",
				plugins,
			});
			onTestFinished(() => server.close());
			const module =
				await server.environments.client.transformRequest("/App.svelte");
			// The dependency optimizer versions its files by the whole config, plugins included.
			return module?.code.replaceAll(/\?v=\w+/g, "");
		};

		const server = code((await built(dir, withTexts(), "server")).files);

		expect(server).toContain("get text() {");
		expect(server).not.toContain("m.title()");
		expect(await served(withTexts())).toBe(await served(withCalls()));
	});

	it("fails the build when it is listed after Svelte's plugin", async () => {
		const dir = svelteApp({ "App.svelte": "<h1>Title</h1>" });

		await expect(built(dir, [svelte(), grai()], "client")).rejects.toThrow(
			"list grai() from grai/svelte before sveltekit() or svelte()",
		);
	});
});
