import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { build, createServer } from "vite";
import { describe, expect, it, onTestFinished } from "vitest";
import { grai } from "../src/vite.ts";
import { project } from "./project.ts";

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}", footer: "Footer" },
	de: { title: "Titel", greeting: "Hallo {name}", footer: "Fußzeile" },
};

/** The chunks a Vite build of `entries` writes, by entry name: each one's code with its imports'. */
async function builtEntries(dir: string, entries: Record<string, string>) {
	for (const [name, code] of Object.entries(entries))
		writeFileSync(join(dir, `${name}.js`), code);
	const output = await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins: [grai()],
		build: {
			write: false,
			minify: false,
			rolldownOptions: {
				input: Object.fromEntries(
					Object.keys(entries).map((name) => [name, join(dir, `${name}.js`)]),
				),
			},
		},
	});
	const chunks = (Array.isArray(output) ? output : [output])
		.flatMap((result) => ("output" in result ? result.output : []))
		.filter((file) => file.type === "chunk");
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
	return Object.fromEntries(
		chunks
			.filter((chunk) => chunk.isEntry)
			.map((chunk) => [chunk.name, loaded(chunk.fileName)]),
	);
}

describe("the Vite plugin's build", () => {
	it("gives each entry only the keys its code uses", async () => {
		const { dir } = project(catalogs);
		const entries = await builtEntries(dir, {
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
			builtEntries(dir, {
				a: `import { m } from "./out/messages.js";\nconsole.log(m.title());\n`,
			}),
		).rejects.toThrow(/catalog/);
	});
});

describe("the Vite plugin's dev server", () => {
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
