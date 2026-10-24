import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import {
	build,
	createServer,
	type HotPayload,
	isRunnableDevEnvironment,
} from "vite";
import { describe, expect, it, onTestFinished } from "vitest";
import { grai } from "../src/vite.ts";
import { type Messages, project } from "./project.ts";

/**
 * What a test's dev server leaves Vite's watcher off: the page and render files the test writes
 * just before the server starts. macOS reports files written that late as changed once the
 * watcher runs (14 of 20 trials, about 110 ms after the start), and Vite reloads the page for
 * them, or keeps the reload for the page that connects next. Tests edit catalogs only, which Vite
 * still watches, so a test still sees a reload the plugin would let through.
 */
const fixtures = { ignored: ["**/index.html", "**/main.js", "**/render.js"] };

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}", footer: "Footer" },
	de: { title: "Titel", greeting: "Hallo {name}", footer: "Fußzeile" },
};

/**
 * What a Vite build of `entries` writes, for a browser or, with `ssr`, for a server: every file,
 * and each entry's code with its imports'.
 */
async function built(
	dir: string,
	entries: Record<string, string>,
	{ write = false, ssr = false } = {},
) {
	for (const [name, code] of Object.entries(entries))
		writeFileSync(join(dir, `${name}.js`), code);
	const output = await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins: [grai()],
		build: {
			write,
			ssr,
			outDir: join(dir, "dist"),
			rolldownOptions: {
				input: Object.fromEntries(
					Object.keys(entries).map((name) => [name, join(dir, `${name}.js`)]),
				),
			},
		},
	});
	const files = (Array.isArray(output) ? output : [output]).flatMap((result) =>
		"output" in result ? result.output : [],
	);
	const chunks = files.filter((file) => file.type === "chunk");
	const byFile = new Map(chunks.map((chunk) => [chunk.fileName, chunk]));
	const loaded = (file: string, seen = new Set<string>()): string => {
		if (seen.has(file)) return "";
		seen.add(file);
		const chunk = byFile.get(file);
		return chunk === undefined
			? ""
			: chunk.code +
					chunk.imports.map((imported) => loaded(imported, seen)).join("");
	};
	const entryCode = Object.fromEntries(
		chunks
			.filter((chunk) => chunk.isEntry)
			.map((chunk) => [chunk.name, loaded(chunk.fileName)]),
	);
	const sources = new Map(
		files.map((file) => [
			file.fileName,
			file.type === "chunk" ? file.code : String(file.source),
		]),
	);
	const entryFiles = Object.fromEntries(
		chunks
			.filter((chunk) => chunk.isEntry)
			.map((chunk) => [chunk.name, chunk.fileName]),
	);
	return { entries: entryCode, sources, entryFiles };
}

describe("the Vite plugin's build", () => {
	it("gives each entry only the keys its code uses", async () => {
		const { dir } = project(catalogs);
		const { entries } = await built(dir, {
			a: `import { m } from "./out/messages.js";\nconsole.log(m.title(), m.greeting({ name: "Ana" }));\n`,
			b: `import { m } from "./out/messages.js";\nconsole.log(m.footer(), m.greeting({ name: "Ana" }));\n`,
		});

		expect([
			entries.a?.includes("Titel"),
			entries.a?.includes("Fußzeile"),
			entries.a?.includes("Hallo"),
		]).toEqual([true, false, true]);
		expect([
			entries.b?.includes("Titel"),
			entries.b?.includes("Fußzeile"),
			entries.b?.includes("Hallo"),
		]).toEqual([false, true, true]);
	});

	it("writes a message's functions as arrows for a browser, and as function expressions for a server", async () => {
		const { dir } = project(catalogs);
		const { entries: browser } = await built(dir, {
			page: `import { m } from "./out/messages.js";\ndocument.body.textContent = m.greeting({ name: "Ana" });\n`,
		});
		const { entries: server, entryFiles } = await built(
			dir,
			{ server: `export { m } from "./out/messages.js";\n` },
			{ write: true, ssr: true },
		);
		const { m }: { m: Messages } = await import(
			pathToFileURL(join(dir, "dist", entryFiles.server ?? "")).href
		);

		expect(browser.page).toMatch(/=>`Hallo \$\{/);
		expect(server.server).toMatch(
			/function ?\(i\) \{\s*return `Hallo \$\{i\.name\}`/,
		);
		expect([
			m.greeting?.({ name: "Ana" }, { locale: "en" }),
			m.greeting?.({ name: "Ana" }, { locale: "de" }),
		]).toEqual(["Hello Ana", "Hallo Ana"]);
	});

	it("fails the build with the compiler's errors", async () => {
		const { dir } = project({ en: { title: "Title" }, de: {} });
		await expect(
			built(dir, {
				a: `import { m } from "./out/messages.js";\nconsole.log(m.title());\n`,
			}),
		).rejects.toThrow(/catalog/);
	});
});

describe("the Vite plugin's locale copies", () => {
	const page = `import { m } from "./out/messages.js";\ndocument.body.textContent = m.title();\n`;

	it("writes each message chunk once per locale, with only that locale's words", async () => {
		const { dir } = project(catalogs);
		const { sources } = await built(dir, { page });
		const messageChunks = [...sources.keys()].filter((file) =>
			file.startsWith("grai/"),
		);
		const words = (file: string) => [
			sources.get(file)?.includes("Title"),
			sources.get(file)?.includes("Titel"),
		];

		expect(messageChunks.length).toBeGreaterThan(0);
		for (const file of messageChunks) {
			expect(words(file)).toEqual([true, true]);
			expect(words(file.replace("grai/", "grai-en/"))).toEqual([true, false]);
			expect(words(file.replace("grai/", "grai-de/"))).toEqual([false, true]);
		}
	});

	it("serves a page its locale's words alone through an import map", async () => {
		const { dir } = project(catalogs);
		const { entryFiles } = await built(dir, { page }, { write: true });
		const html = `<!doctype html><html lang="de"><script type="importmap">{"imports":{"/grai/":"/grai-de/"}}</script><script type="module" src="/${entryFiles.page}"></script>`;
		const browser = await chromium.launch();
		onTestFinished(() => browser.close());
		const tab = await browser.newPage();
		const requested: string[] = [];
		await tab.route("http://grai.test/**", (route) => {
			const path = new URL(route.request().url()).pathname;
			requested.push(path);
			return path === "/"
				? route.fulfill({ contentType: "text/html", body: html })
				: route.fulfill({
						contentType: "text/javascript",
						body: readFileSync(join(dir, "dist", path)),
					});
		});
		await tab.goto("http://grai.test/");
		await tab.waitForFunction(`document.body.textContent === "Titel"`);

		expect(requested.some((path) => path.startsWith("/grai/"))).toBe(false);
		expect(requested.some((path) => path.startsWith("/grai-de/"))).toBe(true);
	});

	it("throws a GraiError naming both locales for a call in another locale than the page's", async () => {
		const { dir } = project(catalogs);
		const { entryFiles } = await built(
			dir,
			{
				page: `import { m } from "./out/messages.js";
try {
	m.title({}, { locale: "en" });
} catch (error) {
	document.body.textContent = \`\${error.code}: \${error.message}\`;
}
`,
			},
			{ write: true },
		);
		const browser = await chromium.launch();
		onTestFinished(() => browser.close());
		const tab = await browser.newPage();
		await tab.route("http://grai.test/**", (route) => {
			const path = new URL(route.request().url()).pathname;
			return path === "/"
				? route.fulfill({
						contentType: "text/html",
						body: `<!doctype html><html lang="de"><script type="importmap">{"imports":{"/grai/":"/grai-de/"}}</script><script type="module" src="/${entryFiles.page}"></script>`,
					})
				: route.fulfill({
						contentType: "text/javascript",
						body: readFileSync(join(dir, "dist", path)),
					});
		});
		await tab.goto("http://grai.test/");
		await tab.waitForFunction(`document.body.textContent !== ""`);

		expect(await tab.textContent("body")).toBe(
			'locale-not-loaded: A message was called in "en", but this page renders in "de" alone.',
		);
	});
});

describe("the Vite plugin's dev server", () => {
	/** A dev server of the project, and a server render of its title through Vite's SSR runner. */
	async function serverRender(dir: string) {
		writeFileSync(
			join(dir, "render.js"),
			`import { m } from "./out/messages.js";\nexport const render = () => m.title();\n`,
		);
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { watch: fixtures },
			plugins: [grai()],
		});
		onTestFinished(() => server.close());
		const ssr = server.environments.ssr;
		if (!isRunnableDevEnvironment(ssr)) throw new Error("ssr is not runnable");
		return async () =>
			(await ssr.runner.import<{ render(): string }>("/render.js")).render();
	}

	it("has an import of the output wait for the first compile, rather than fail", async () => {
		const { dir } = project(catalogs);
		const rendered = await serverRender(dir);

		expect(await rendered()).toBe("Title");
	});

	it("fails an import of the output, rather than hold it, when the first compile throws", async () => {
		const { dir } = project(catalogs);
		writeFileSync(join(dir, "out"), "");
		const rendered = await serverRender(dir);

		await expect(rendered()).rejects.toThrow();
	});

	/** A dev server of the project, and a page in German running `main` in Chromium. */
	async function devPage(dir: string, main: string) {
		writeFileSync(
			join(dir, "index.html"),
			`<!doctype html><html lang="de"><p id="title"></p><script type="module" src="/main.js"></script>`,
		);
		writeFileSync(join(dir, "main.js"), main);
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { port: 0, watch: fixtures },
			plugins: [grai()],
		});
		await server.listen();
		onTestFinished(() => server.close());
		const browser = await chromium.launch();
		onTestFinished(() => browser.close());
		const page = await browser.newPage();
		await page.goto(server.resolvedUrls?.local[0] ?? "");
		// Strings, not functions: the test's TypeScript has no DOM types.
		const title = (text: string) =>
			page.waitForFunction(
				`document.getElementById("title").textContent === ${JSON.stringify(text)}`,
			);
		return { page, title };
	}

	it("patches a server render's messages in place, and a later evaluation keeps the edit", async () => {
		const { dir } = project(catalogs);
		writeFileSync(
			join(dir, "render.js"),
			`import { m } from "./out/messages.js";
globalThis.evaluated = (globalThis.evaluated ?? 0) + 1;
export const render = () => \`\${m.title()} \${globalThis.evaluated}\`;
`,
		);
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { port: 0, watch: fixtures },
			plugins: [grai()],
		});
		onTestFinished(() => server.close());
		const ssr = server.environments.ssr;
		if (!isRunnableDevEnvironment(ssr)) throw new Error("ssr is not runnable");
		await server.listen();
		await expect
			.poll(() => existsSync(join(dir, "out", "messages.js")))
			.toBe(true);
		const rendered = async () =>
			(await ssr.runner.import<{ render(): string }>("/render.js")).render();
		expect(await rendered()).toBe("Title 1");

		const catalog = join(dir, "messages", "en.json");
		writeFileSync(
			catalog,
			readFileSync(catalog, "utf8").replace('"Title"', '"Heading"'),
		);

		await expect.poll(rendered).toBe("Heading 1");
		// The next time the runner evaluates the program, for any other reason, it keeps the edit.
		ssr.hot.send({ type: "full-reload" });
		await expect.poll(rendered).toBe("Heading 2");
	});

	it("closes once the compile under way has finished, leaving the project to remove", async () => {
		const { dir } = project(catalogs);
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { watch: fixtures },
			plugins: [grai()],
		});
		await server.close();

		expect(existsSync(join(dir, "out", "messages.js"))).toBe(true);
	});

	it("shows an edited message without reloading the page", async () => {
		const { dir } = project(catalogs);
		const { page, title } = await devPage(
			dir,
			`import { m } from "./out/messages.js";
const render = () => { document.getElementById("title").textContent = m.title(); };
render();
addEventListener("grai:change", (event) => { event.preventDefault(); render(); });
window.loaded = performance.timeOrigin;
`,
		);
		await title("Titel");
		const loaded = await page.evaluate("window.loaded");

		const catalog = join(dir, "messages", "de.json");
		writeFileSync(
			catalog,
			readFileSync(catalog, "utf8").replace('"Titel"', '"Überschrift"'),
		);
		await title("Überschrift");

		expect(await page.evaluate("window.loaded")).toBe(loaded);
	});

	it("throws for a call in another locale than the page's, as a build does, naming the key", async () => {
		const { dir } = project(catalogs);
		const { title } = await devPage(
			dir,
			`import { m } from "./out/messages.js";
try {
	m.title({}, { locale: "en" });
} catch (error) {
	document.getElementById("title").textContent = \`\${error.code}: \${error.message}\`;
}
`,
		);

		await title(
			'locale-not-loaded: title was called in "en", but this page renders in "de" alone.',
		);
	});
});

describe("the Vite plugin's dev server, after a compile fails", () => {
	const broken = (dir: string) =>
		writeFileSync(join(dir, "messages", "de.json"), '{ "title": "Tit');
	const fixed = (dir: string, title: string) =>
		writeFileSync(
			join(dir, "messages", "de.json"),
			JSON.stringify({ ...catalogs.de, title }, null, "\t"),
		);

	/** A dev server of the project, with the payloads it sends its pages, and a browser. */
	async function devServer(dir: string) {
		writeFileSync(
			join(dir, "index.html"),
			`<!doctype html><html lang="de"><p id="title"></p><script type="module" src="/main.js"></script>`,
		);
		writeFileSync(
			join(dir, "main.js"),
			`import { m } from "./out/messages.js";
const render = () => { document.getElementById("title").textContent = m.title(); };
render();
addEventListener("grai:change", (event) => { event.preventDefault(); render(); });
import.meta.hot.on("test:ping", () => { window.pinged = true; });
`,
		);
		const sent: string[] = [];
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { port: 0, watch: fixtures },
			plugins: [
				grai(),
				{
					name: "sent",
					configureServer(vite) {
						const hot = vite.environments.client.hot;
						const send = hot.send.bind(hot);
						hot.send = (payload: HotPayload | string, data?: unknown) => {
							if (typeof payload === "string") {
								sent.push(payload);
								send(payload, data);
							} else {
								sent.push(payload.type);
								send(payload);
							}
						};
					},
				},
			],
		});
		await server.listen();
		onTestFinished(() => server.close());
		const browser = await chromium.launch();
		onTestFinished(() => browser.close());
		return { server, sent, browser };
	}

	it("takes the error down for a page that connects after the fix", async () => {
		const { dir } = project(catalogs);
		const { server, sent, browser } = await devServer(dir);
		await expect
			.poll(() => existsSync(join(dir, "out", "messages.js")))
			.toBe(true);
		broken(dir);
		await expect.poll(() => sent.includes("error")).toBe(true);
		const errors = sent.length;
		fixed(dir, "Überschrift");
		await expect.poll(() => sent.length > errors).toBe(true);

		const page = await browser.newPage();
		await page.goto(server.resolvedUrls?.local[0] ?? "");
		// Pages get their payloads in order: once a ping has come, an error kept for the page has too.
		await expect
			.poll(async () => {
				server.ws.send("test:ping");
				return await page.evaluate("window.pinged === true").catch(() => false);
			})
			.toBe(true);

		expect(
			await page.evaluate(
				`[document.getElementById("title").textContent, document.querySelector("vite-error-overlay") === null]`,
			),
		).toEqual(["Überschrift", true]);
	});

	it("takes the error down from an open page", async () => {
		const { dir } = project(catalogs);
		const { server, browser } = await devServer(dir);
		const page = await browser.newPage();
		await page.goto(server.resolvedUrls?.local[0] ?? "");
		await page.waitForFunction(
			`document.getElementById("title").textContent === "Titel"`,
		);
		broken(dir);
		await page.waitForFunction(
			`document.querySelector("vite-error-overlay") !== null`,
		);

		fixed(dir, "Überschrift");

		await page.waitForFunction(
			`document.querySelector("vite-error-overlay") === null && document.getElementById("title").textContent === "Überschrift"`,
		);
	});
});
