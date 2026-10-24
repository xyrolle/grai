import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build, createServer, type HotPayload } from "vite";
import { describe, expect, it, onTestFinished } from "vitest";
import { grai } from "../src/vite.ts";
import { project } from "./project.ts";

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}", footer: "Footer" },
	de: { title: "Titel", greeting: "Hallo {name}", footer: "Fußzeile" },
};

/** What a Vite build of `entries` writes: every file, and each entry's code with its imports'. */
async function built(
	dir: string,
	entries: Record<string, string>,
	{ write = false } = {},
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
});

describe("the Vite plugin's dev server", () => {
	it("closes once the compile under way has finished, leaving the project to remove", async () => {
		const { dir } = project(catalogs);
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			plugins: [grai()],
		});
		await server.close();

		expect(existsSync(join(dir, "out", "messages.js"))).toBe(true);
	});

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
			server: { port: 0 },
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

	it("shows an edited message without reloading the page", async () => {
		const { dir } = project(catalogs);
		writeFileSync(
			join(dir, "index.html"),
			`<!doctype html><p id="title"></p><script type="module" src="/main.js"></script>`,
		);
		writeFileSync(
			join(dir, "main.js"),
			`import { m } from "./out/messages.js";
const render = () => { document.getElementById("title").textContent = m.title({}, { locale: "de" }); };
render();
addEventListener("grai:change", (event) => { event.preventDefault(); render(); });
window.loaded = performance.timeOrigin;
`,
		);
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { port: 0 },
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
			server: { port: 0 },
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
