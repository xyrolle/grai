import {
	cpSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import {
	build,
	createServer,
	type HotPayload,
	isRunnableDevEnvironment,
	type Plugin,
} from "vite";
import { describe, expect, it, onTestFinished } from "vitest";
import { recompile } from "../src/compile.ts";
import { localeCopies } from "../src/locale-chunks.ts";
import { grai, graiModules } from "../src/vite.ts";
import { ownChunkBytes } from "../src/vite-build.ts";
import { type Messages, project } from "./project.ts";

/**
 * What a test's dev server leaves Vite's watcher off: the page, package and render files the test
 * writes just before the server starts. macOS reports files written that late as changed once the
 * watcher runs (14 of 20 trials, about 110 ms after the start), and Vite reloads the page for
 * them, or keeps the reload for the page that connects next. Tests edit catalogs only, which Vite
 * still watches, so a test still sees a reload the plugin would let through.
 */
const fixtures = {
	ignored: ["**/index.html", "**/main.js", "**/package.json", "**/render.js"],
};

/**
 * Where a test's dev server listens: 127.0.0.1 alone, at a port the system picks. On `localhost`
 * it may listen on ::1 alone, and another process may hold 127.0.0.1 at that port, which a browser
 * reaches as `localhost` too.
 */
const loopback = { host: "127.0.0.1", port: 0 };

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}", footer: "Footer" },
	de: { title: "Titel", greeting: "Hallo {name}", footer: "Fußzeile" },
};

/** A package.json that maps each key's path to keys.js, as an app that imports keys by path does. */
const perKeyImports = JSON.stringify({
	imports: { "#i18n/messages/*": "./out/keys.js" },
});

/** A plugin that keeps the message of each error the dev server sends its pages. */
function sentErrors(errors: string[]): Plugin {
	return {
		name: "sent-errors",
		configureServer(server) {
			const hot = server.environments.client.hot;
			const send = hot.send.bind(hot);
			hot.send = (payload: HotPayload | string, data?: unknown) => {
				if (typeof payload === "string") return send(payload, data);
				if (payload.type === "error") errors.push(payload.err.message);
				send(payload);
			};
		},
	};
}

/**
 * A symlink to a project's directory, as a project is reached through macOS's `/tmp` or a linked
 * workspace. The bundler names its modules by their real paths. It is removed after the test.
 */
function linked(dir: string): string {
	const parent = realpathSync(mkdtempSync(join(tmpdir(), "grai-link-")));
	onTestFinished(() => rmSync(parent, { recursive: true }));
	const link = join(parent, "project");
	symlinkSync(dir, link);
	return link;
}

/**
 * What a Vite build of `entries` writes, for a browser or, with `ssr`, for a server: every file,
 * its chunks, and each entry's code with its imports'.
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
	return { entries: entryCode, sources, entryFiles, chunks };
}

/** A word repeated into a message whose key's module alone reaches `ownChunkBytes`. */
const sized = (word: string) =>
	`${word} `.repeat(Math.ceil(ownChunkBytes / word.length));

describe("the Vite plugin's build", () => {
	it("gives each entry only the keys its code uses, when each set of them is worth a chunk of its own", async () => {
		const { dir } = project({
			en: {
				title: sized("Title"),
				greeting: `${sized("Hello")} {name}`,
				footer: sized("Footer"),
			},
			de: {
				title: sized("Titel"),
				greeting: `${sized("Hallo")} {name}`,
				footer: sized("Fußzeile"),
			},
		});
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
			/function ?\(i\) \{\s*return `Hallo \$\{i\["name"\]\}`/,
		);
		expect([
			m.greeting?.({ name: "Ana" }, { locale: "en" }),
			m.greeting?.({ name: "Ana" }, { locale: "de" }),
		]).toEqual(["Hello Ana", "Hallo Ana"]);
	});

	it("ships no pseudo-locale, even over the output of a dev server that compiled one", async () => {
		const { dir, config } = project(catalogs, { pseudoLocale: "en-XA" });
		await recompile(config, undefined, { pseudoLocale: true });

		const { sources } = await built(dir, {
			a: `import { m } from "./out/messages.js";\nimport { locales } from "./out/runtime.js";\nconsole.log(m.title(), locales);\n`,
		});

		const shipped = [...sources.values()].join("\n");
		expect([shipped.includes("Titel"), shipped.includes("en-XA")]).toEqual([
			true,
			false,
		]);
		expect(shipped).not.toContain("Ţîţļé");
	});

	it("refuses the output's testing.js in a build, so a test's locale binding never ships", async () => {
		const { dir } = project(catalogs);
		await expect(
			built(dir, {
				a: `import { useLocale } from "./out/testing.js";\nuseLocale("de");\n`,
			}),
		).rejects.toThrow(
			/testing\.js binds a test's locale, so a build refuses it/,
		);
	});

	it("fails the build with the compiler's errors", async () => {
		const { dir } = project({ en: { title: "Title" }, de: {} });
		await expect(
			built(dir, {
				a: `import { m } from "./out/messages.js";\nconsole.log(m.title());\n`,
			}),
		).rejects.toThrow(/catalog/);
	});

	it("fails the build where a source names a key no catalog has, as grai check does", async () => {
		const { dir } = project(catalogs);

		await expect(
			built(dir, {
				a: `import { m } from "./out/messages.js";\nconsole.log(m.title(), m.subtitle(), m["caption"]());\n`,
			}),
		).rejects.toThrow(
			[
				'a.js:2:26: "subtitle": m.subtitle names a key no catalog has. Add it with grai add subtitle --en "…" --de "…", or fix the name.',
				'a.js:2:41: "caption": m["caption"] names a key no catalog has. Add it with grai add caption --en "…" --de "…", or fix the name.',
			].join("\n"),
		);
	});
});

describe("the Vite plugin's message chunks", () => {
	/** The keys each message chunk of a client build holds, by its file name. */
	const keysOf = (
		chunks: readonly { fileName: string; moduleIds: string[] }[],
	) =>
		new Map(
			chunks
				.filter((chunk) => chunk.fileName.startsWith("assets/grai/"))
				.map((chunk) => [
					chunk.fileName,
					chunk.moduleIds.map((id) => id.replace("\0grai:key/", "")).sort(),
				]),
		);

	it("gives a set of keys the same entries use a chunk of its own once it reaches ownChunkBytes, and pools the smaller sets apart from it", async () => {
		const { dir } = project({
			en: { article: sized("Article"), save: "Save", close: "Close" },
			de: { article: sized("Artikel"), save: "Speichern", close: "Schließen" },
		});
		const { chunks, entries } = await built(dir, {
			article: `import { m } from "./out/messages.js";\nconsole.log(m.article(), m.save());\n`,
			dialog: `import { m } from "./out/messages.js";\nconsole.log(m.save(), m.close());\n`,
		});

		expect([...keysOf(chunks).values()].sort()).toEqual([
			["article"],
			["close", "save"],
		]);
		expect(entries.dialog?.includes("Artikel")).toBe(false);
	});

	it("keeps the keys a first paint needs apart from the keys only a later import needs", async () => {
		const { dir } = project({
			en: { now: "Now", later: "Later" },
			de: { now: "Jetzt", later: "Später" },
		});
		writeFileSync(
			join(dir, "later.js"),
			`import { m } from "./out/messages.js";\nexport const later = m.later();\n`,
		);
		const { chunks, entries } = await built(dir, {
			page: `import { m } from "./out/messages.js";\nconsole.log(m.now());\nimport("./later.js");\n`,
		});

		expect([...keysOf(chunks).values()].sort()).toEqual([["later"], ["now"]]);
		expect(entries.page?.includes("Später")).toBe(false);
	});

	it("pools sets of keys under ownChunkBytes, so a page of many of them makes few requests, each copy in its locale's words alone", async () => {
		const pages = Array.from({ length: 12 }, (_, index) => `page${index}`);
		const catalog = (locale: string) =>
			Object.fromEntries([
				["title", `${locale} title`],
				...pages.map((page) => [page, `${locale} ${page}`]),
			]);
		const { dir } = project({ en: catalog("en"), de: catalog("de") });
		const { chunks, sources } = await built(
			dir,
			Object.fromEntries(
				pages.map((page) => [
					page,
					`import { m } from "./out/messages.js";\nconsole.log(m.title(), m.${page}());\n`,
				]),
			),
		);
		const messageChunks = [...keysOf(chunks).keys()];
		const words = (file: string, locale: string) =>
			(sources.get(file) ?? "").includes(`${locale} `);

		expect(messageChunks.length).toBe(1);
		for (const file of messageChunks) {
			expect([
				words(file.replace("grai/", "grai-en/"), "en"),
				words(file.replace("grai/", "grai-en/"), "de"),
				words(file.replace("grai/", "grai-de/"), "en"),
				words(file.replace("grai/", "grai-de/"), "de"),
			]).toEqual([true, false, false, true]);
		}
	});

	it("chunks a project alike wherever it lives", async () => {
		// Enough keys on one page, and a directory deep enough, that the directory's path in each key
		// module's code would alone lift the page's keys past ownChunkBytes.
		const deep = join(...Array.from({ length: 4 }, () => "d".repeat(200)));
		const keys = Array.from(
			{ length: Math.ceil(ownChunkBytes / deep.length) + 1 },
			(_, index) => `key${index}`,
		);
		const catalog = Object.fromEntries(
			[...keys, "other"].map((key) => [key, key]),
		);
		const near = project({ en: catalog, de: catalog }).dir;
		const root = realpathSync(mkdtempSync(join(tmpdir(), "grai-")));
		onTestFinished(() => rmSync(root, { recursive: true }));
		const far = join(root, deep);
		cpSync(near, far, { recursive: true });
		const entries = {
			page: `import { m } from "./out/messages.js";\nconsole.log(${keys.map((key) => `m.${key}()`).join(", ")});\n`,
			other: `import { m } from "./out/messages.js";\nconsole.log(m.other());\n`,
		};

		const nearChunks = keysOf((await built(near, entries)).chunks);

		expect(keysOf((await built(far, entries)).chunks)).toEqual(nearChunks);
		expect(nearChunks.size).toBe(1);
	});
});

describe("grai/vite's module kinds", () => {
	it("names each module of grai's in a client build by its kind, as the chunk it went to", async () => {
		const catalog = {
			title: "Title",
			total: "{amount :number}",
			items: [
				{
					declarations: ["input count", "local countPlural = count: plural"],
					selectors: ["countPlural"],
					match: {
						"countPlural=one": "{count} item",
						"countPlural=other": "{count} items",
					},
				},
			],
		};
		const { dir, config } = project({ en: catalog, de: catalog });
		const { chunks } = await built(dir, {
			page: `import { m } from "./out/messages.js";\nconsole.log(m.title(), m.total({ amount: 1 }), m.items({ count: 2 }));\n`,
		});
		const kindOf = graiModules({ config });
		const placed = Object.fromEntries(
			chunks.flatMap((chunk) =>
				chunk.moduleIds.map((id) => [
					id.replace(`${dir}/`, ""),
					[kindOf(id), chunk.name],
				]),
			),
		);

		expect(placed).toEqual({
			"page.js": [undefined, "page"],
			"out/dispatch.js": ["runtime", "grai-runtime"],
			"out/config.js": ["config", "grai-runtime"],
			"out/plurals.js": ["plurals", "grai-runtime"],
			"out/formats.js": ["formats", "grai-runtime"],
			"\0grai:key/title": ["key", "grai~page"],
			"\0grai:key/total": ["key", "grai~page"],
			"\0grai:key/items": ["key", "grai~page"],
		});
	});

	it("names the output's modules by their real paths, for a project reached through a symlink", () => {
		const { dir } = project(catalogs);
		const kindOf = graiModules({
			config: join(linked(dir), "grai.config.json"),
		});

		expect(kindOf(join(dir, "out", "runtime.js"))).toBe("runtime");
	});
});

describe("the Vite plugin's locale copies", () => {
	const page = `import { m } from "./out/messages.js";\ndocument.body.textContent = m.title();\n`;

	it("copies a chunk byte for byte, each call keeping only its locale's variants, at their position", () => {
		const chunk = (calls: string) =>
			`import { markup, message, text } from "../grai-runtime.js";\n${calls}\nexport { greeting, terms, title };\n`;
		const copies = localeCopies(
			"chunk.js",
			chunk(`var title = /*#__PURE__*/ text("Title", "Titel");
var greeting = /*#__PURE__*/ message((i) => \`Hello \${i.name}\`, (i) => \`Hallo \${i.name}\`);
var terms = /*#__PURE__*/ markup([(i) => "Terms", (i) => "AGB"], [(i) => [], (i) => [{ type: "text", value: "AGB" }]]);`),
			["en", "de"],
		);

		expect(Object.fromEntries(copies)).toEqual({
			en: chunk(`var title = /*#__PURE__*/ text("Title");
var greeting = /*#__PURE__*/ message((i) => \`Hello \${i.name}\`);
var terms = /*#__PURE__*/ markup([(i) => "Terms"], [(i) => []]);`),
			de: chunk(`var title = /*#__PURE__*/ text(void 0, "Titel");
var greeting = /*#__PURE__*/ message(void 0, (i) => \`Hallo \${i.name}\`);
var terms = /*#__PURE__*/ markup([void 0, (i) => "AGB"], [void 0, (i) => [{ type: "text", value: "AGB" }]]);`),
		});
	});

	it("puts the message chunks and their copies inside the build's chunk directory, which hosts cache as immutable", async () => {
		const { dir } = project(catalogs);
		const { sources } = await built(dir, { page });
		const directories = new Set(
			[...sources.keys()].map((file) => file.slice(0, file.lastIndexOf("/"))),
		);

		expect([...directories].sort()).toEqual([
			"assets",
			"assets/grai",
			"assets/grai-de",
			"assets/grai-en",
		]);
	});

	it("puts the runtime in a chunk of its own and the messages in chunks copied per locale, for a project reached through a symlink", async () => {
		const { dir } = project(catalogs);
		const { chunks, sources } = await built(linked(dir), { page });
		const directories = new Set(
			[...sources.keys()].map((file) => file.slice(0, file.lastIndexOf("/"))),
		);

		expect(chunks.map((chunk) => chunk.name).sort()).toEqual([
			"grai-runtime",
			"grai~page",
			"page",
		]);
		expect([...directories].sort()).toEqual([
			"assets",
			"assets/grai",
			"assets/grai-de",
			"assets/grai-en",
		]);
	});

	it("writes each message chunk once per locale, with only that locale's words", async () => {
		const { dir } = project(catalogs);
		const { sources } = await built(dir, { page });
		const messageChunks = [...sources.keys()].filter((file) =>
			file.startsWith("assets/grai/"),
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

	it("links each copy to the chunks it imports, in a build of many chunks", async () => {
		// A page per key, each worth a chunk of its own, gives the build enough chunks that the
		// bundler's placeholders for their hashes run past digits.
		const keys = Array.from({ length: 12 }, (_, index) => `key${index}`);
		const catalog = Object.fromEntries(keys.map((key) => [key, sized(key)]));
		const { dir } = project({ en: catalog, de: catalog });
		const { sources } = await built(
			dir,
			Object.fromEntries(
				keys.map((key) => [
					key,
					`import { m } from "./out/messages.js";\nconsole.log(m.${key}());\n`,
				]),
			),
		);
		const copies = [...sources.keys()].filter((file) =>
			/^assets\/grai-(en|de)\//.test(file),
		);
		const imported = copies.flatMap((file) =>
			[...(sources.get(file) ?? "").matchAll(/from\s*"([^"]+)"/g)].map(
				([, path = ""]) => join(dirname(file), path),
			),
		);

		expect(copies.length).toBe(2 * keys.length);
		expect(imported.filter((file) => !sources.has(file))).toEqual([]);
	});

	it("serves a page its locale's words alone through an import map", async () => {
		const { dir } = project(catalogs);
		const { entryFiles } = await built(dir, { page }, { write: true });
		const html = `<!doctype html><html lang="de"><script type="importmap">{"imports":{"/assets/grai/":"/assets/grai-de/"}}</script><script type="module" src="/${entryFiles.page}"></script>`;
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

		expect(requested.some((path) => path.startsWith("/assets/grai/"))).toBe(
			false,
		);
		expect(requested.some((path) => path.startsWith("/assets/grai-de/"))).toBe(
			true,
		);
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
						body: `<!doctype html><html lang="de"><script type="importmap">{"imports":{"/assets/grai/":"/assets/grai-de/"}}</script><script type="module" src="/${entryFiles.page}"></script>`,
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

/**
 * A dev server test's budget, and each wait's within it. On a loaded machine, launching Chromium,
 * starting a dev server and loading a page take seconds each: past Vitest's 5 s for a test and
 * expect.poll's 1 s for a wait. A wait gets Playwright's own 30 s, so a condition never reached
 * fails as itself before the test's minute runs out.
 */
const devTest = { timeout: 60_000 };
const devWait = { timeout: 30_000 };

describe("the Vite plugin's dev server", devTest, () => {
	/** A dev server of the project, and a server render of its render.js through Vite's SSR runner. */
	async function serverRenderOf(dir: string, plugins: Plugin[] = []) {
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { watch: fixtures },
			plugins: [grai(), ...plugins],
		});
		onTestFinished(() => server.close());
		const ssr = server.environments.ssr;
		if (!isRunnableDevEnvironment(ssr)) throw new Error("ssr is not runnable");
		return async () =>
			(await ssr.runner.import<{ render(): string }>("/render.js")).render();
	}

	/** A server render of the project's title. */
	function serverRender(dir: string) {
		writeFileSync(
			join(dir, "render.js"),
			`import { m } from "./out/messages.js";\nexport const render = () => m.title();\n`,
		);
		return serverRenderOf(dir);
	}

	it("has an import of the output wait for the first compile, rather than fail", async () => {
		const { dir } = project(catalogs);
		const rendered = await serverRender(dir);

		expect(await rendered()).toBe("Title");
	});

	it("loads a per-key import of a key no catalog has, whose call throws, and takes the key once it is added", async () => {
		const { dir } = project(catalogs);
		writeFileSync(join(dir, "package.json"), perKeyImports);
		writeFileSync(
			join(dir, "render.js"),
			`import { title } from "#i18n/messages/title.js";
import { subtitle } from "#i18n/messages/subtitle.js";
export const render = () => {
	try {
		return \`\${title()} \${subtitle()}\`;
	} catch (error) {
		return \`\${error.code}: \${error.message}\`;
	}
};
`,
		);
		const errors: string[] = [];
		const rendered = await serverRenderOf(dir, [sentErrors(errors)]);

		expect(await rendered()).toBe(
			'key-missing: "subtitle" is imported by its path, but no catalog has it. Add it to every catalog, or fix the import.',
		);
		expect(errors).toEqual([
			'render.js imports "subtitle" by its path, but no catalog has it. Add it to every catalog, or fix the import.',
		]);

		for (const [locale, text] of [
			["en", "Subtitle"],
			["de", "Untertitel"],
		] as const) {
			const catalog = join(dir, "messages", `${locale}.json`);
			const messages = JSON.parse(readFileSync(catalog, "utf8"));
			writeFileSync(
				catalog,
				JSON.stringify({ ...messages, subtitle: text }, null, "\t"),
			);
		}
		await expect.poll(rendered, devWait).toBe("Title Subtitle");
	});

	it("has a per-key import of a key taken out of the catalogs throw when called, rather than fail to load", async () => {
		const { dir } = project(catalogs);
		writeFileSync(join(dir, "package.json"), perKeyImports);
		writeFileSync(
			join(dir, "render.js"),
			`import { footer } from "#i18n/messages/footer.js";
export const render = () => {
	try {
		return footer();
	} catch (error) {
		return error.code;
	}
};
`,
		);
		const rendered = await serverRenderOf(dir);
		expect(await rendered()).toBe("Footer");

		for (const locale of ["en", "de"] as const) {
			const { footer, ...rest } = catalogs[locale];
			writeFileSync(
				join(dir, "messages", `${locale}.json`),
				JSON.stringify(rest, null, "\t"),
			);
		}

		await expect.poll(rendered, devWait).toBe("key-missing");
	});

	it("fails an import of the output, rather than hold it, when the first compile throws", async () => {
		const { dir } = project(catalogs);
		writeFileSync(join(dir, "out"), "");
		const rendered = await serverRender(dir);

		await expect(rendered()).rejects.toThrow();
	});

	it("serves a page that imports the output by a package import before the first compile has written it", async () => {
		const { dir } = project(catalogs);
		// Another writer holds the output, so the first compile waits for it. The writer lets go as
		// the server resolves its first module, which comes before the output exists.
		const lock = join(dir, "out", ".grai", "lock");
		mkdirSync(dirname(lock), { recursive: true });
		writeFileSync(lock, String(process.pid));
		let held = true;
		const writer: Plugin = {
			name: "writer",
			resolveId: {
				order: "pre",
				handler() {
					if (held) rmSync(lock);
					held = false;
					return null;
				},
			},
		};
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ imports: { "#i18n/*": "./out/*" } }),
		);
		writeFileSync(
			join(dir, "index.html"),
			`<!doctype html><script type="module" src="/main.js"></script>`,
		);
		writeFileSync(
			join(dir, "main.js"),
			`import { m } from "#i18n/messages.js";\nexport const title = m.title();\n`,
		);
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { watch: fixtures },
			plugins: [writer, grai()],
		});
		onTestFinished(() => server.close());

		const main = await server.environments.client.transformRequest("/main.js");

		expect(main?.code).toContain('"/out/messages.js"');
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
			server: { ...loopback, watch: fixtures },
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
			server: { ...loopback, watch: fixtures },
			plugins: [grai()],
		});
		onTestFinished(() => server.close());
		const ssr = server.environments.ssr;
		if (!isRunnableDevEnvironment(ssr)) throw new Error("ssr is not runnable");
		await server.listen();
		await expect
			.poll(() => existsSync(join(dir, "out", "messages.js")), devWait)
			.toBe(true);
		const rendered = async () =>
			(await ssr.runner.import<{ render(): string }>("/render.js")).render();
		expect(await rendered()).toBe("Title 1");

		const catalog = join(dir, "messages", "en.json");
		writeFileSync(
			catalog,
			readFileSync(catalog, "utf8").replace('"Title"', '"Heading"'),
		);

		await expect.poll(rendered, devWait).toBe("Heading 1");
		// The next time the runner evaluates the program, for any other reason, it keeps the edit.
		ssr.hot.send({ type: "full-reload" });
		await expect.poll(rendered, devWait).toBe("Heading 2");
	});

	it("reloads the open pages after an edit with reloadOnEdit, rather than patch them, and patches the server's render", async () => {
		const { dir } = project(catalogs);
		writeFileSync(
			join(dir, "render.js"),
			`import { m } from "./out/messages.js";\nexport const render = () => m.title();\n`,
		);
		const sent: string[] = [];
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { watch: fixtures },
			plugins: [
				grai({ reloadOnEdit: true }),
				{
					name: "sent",
					configureServer(vite) {
						const hot = vite.environments.client.hot;
						const send = hot.send.bind(hot);
						hot.send = (payload: HotPayload | string, data?: unknown) => {
							if (typeof payload === "string") send(payload, data);
							else {
								sent.push(
									payload.type === "custom" ? payload.event : payload.type,
								);
								send(payload);
							}
						};
					},
				},
			],
		});
		onTestFinished(() => server.close());
		const ssr = server.environments.ssr;
		if (!isRunnableDevEnvironment(ssr)) throw new Error("ssr is not runnable");
		const rendered = async () =>
			(await ssr.runner.import<{ render(): string }>("/render.js")).render();
		expect(await rendered()).toBe("Title");

		const catalog = join(dir, "messages", "en.json");
		writeFileSync(
			catalog,
			readFileSync(catalog, "utf8").replace('"Title"', '"Heading"'),
		);

		await expect.poll(() => sent).toContain("full-reload");
		await expect.poll(rendered).toBe("Heading");
		expect(sent).not.toContain("grai:update");
	});

	/**
	 * A dev server of the project in a mode, with a server render of two keys imported by their
	 * paths, which the app maps to keys.js, and what each key's path resolves to.
	 */
	async function keyPaths(dir: string, mode: string) {
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ imports: { "#i18n/messages/*": "./out/keys.js" } }),
		);
		writeFileSync(
			join(dir, "render.js"),
			`import { footer } from "#i18n/messages/footer.js";
import { title } from "#i18n/messages/title.js";
export const render = () => \`\${title()} \${footer()}\`;
`,
		);
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			mode,
			server: { watch: fixtures },
			plugins: [grai()],
		});
		onTestFinished(() => server.close());
		const ssr = server.environments.ssr;
		if (!isRunnableDevEnvironment(ssr)) throw new Error("ssr is not runnable");
		const resolved = async (key: string) =>
			(
				await ssr.pluginContainer.resolveId(
					`#i18n/messages/${key}.js`,
					join(dir, "render.js"),
				)
			)?.id;
		const rendered = async () =>
			(await ssr.runner.import<{ render(): string }>("/render.js")).render();
		return { resolved, rendered };
	}

	it("resolves a page's key paths to keys.js, one module for every key", async () => {
		const { dir } = project(catalogs);
		const { resolved, rendered } = await keyPaths(dir, "development");
		const keys = join(dir, "out", "keys.js");

		expect(await rendered()).toBe("Title Footer");
		expect([await resolved("title"), await resolved("footer")]).toEqual([
			keys,
			keys,
		]);
	});

	it("gives each key's path a module of its own in a test run, which an edit still reaches", async () => {
		const { dir } = project(catalogs);
		const { resolved, rendered } = await keyPaths(dir, "test");

		expect(await rendered()).toBe("Title Footer");
		expect([await resolved("title"), await resolved("footer")]).toEqual([
			"\0grai:key/title",
			"\0grai:key/footer",
		]);
		const catalog = join(dir, "messages", "en.json");
		writeFileSync(
			catalog,
			readFileSync(catalog, "utf8").replace('"Title"', '"Heading"'),
		);
		await expect.poll(rendered, devWait).toBe("Heading Footer");
	});

	it("gives the dev module no source map, which Vite would inline at several times its size", async () => {
		const { dir } = project(catalogs);
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
		await ssr.runner.import("/render.js");

		const keys = await ssr.transformRequest(join(dir, "out", "keys.js"));

		expect(keys?.code).toContain("export");
		expect(keys?.code).not.toContain("sourceMappingURL=data:");
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

	it("shows an edited message without reloading the page, for a project reached through a symlink", async () => {
		const { dir } = project(catalogs);
		const { page, title } = await devPage(
			linked(dir),
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

	it("loads a page that imports a key no catalog has, shows the import in the overlay, and throws only when it is called", async () => {
		const { dir } = project(catalogs);
		writeFileSync(join(dir, "package.json"), perKeyImports);
		const { page, title } = await devPage(
			dir,
			`import { subtitle } from "#i18n/messages/subtitle.js";
try {
	subtitle();
} catch (error) {
	document.getElementById("title").textContent = error.code;
}
`,
		);

		await title("key-missing");
		await page.waitForFunction(
			`document.querySelector("vite-error-overlay")?.shadowRoot?.textContent.includes('imports "subtitle" by its path')`,
		);
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

describe("the Vite plugin's dev server, after a compile fails", devTest, () => {
	const broken = (dir: string) =>
		writeFileSync(join(dir, "messages", "de.json"), '{ "title": "Tit');
	const fixed = (dir: string, title: string) =>
		writeFileSync(
			join(dir, "messages", "de.json"),
			JSON.stringify({ ...catalogs.de, title }, null, "\t"),
		);

	/**
	 * A dev server of the project, with the payloads it sends its pages, and a browser. The page
	 * pings the server once connected and, when answered, sends back what it shows.
	 */
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
import.meta.hot.on("test:pong", () => {
	import.meta.hot.send("test:shown", [
		document.getElementById("title").textContent,
		document.querySelector("vite-error-overlay") === null,
	]);
});
import.meta.hot.send("test:ping");
`,
		);
		const sent: string[] = [];
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			server: { ...loopback, watch: fixtures },
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

	it("resolves the output by a path or a package import for a page reloaded after the fix, before Vite's watcher has reported it", async () => {
		const { dir } = project(catalogs);
		broken(dir);
		writeFileSync(
			join(dir, "package.json"),
			JSON.stringify({ imports: { "#i18n/*": "./out/*" } }),
		);
		writeFileSync(
			join(dir, "main.js"),
			`import { m } from "#i18n/messages.js";
import { getLocale } from "./out/runtime.js";
export const title = \`\${getLocale()} \${m.title()}\`;
`,
		);
		let reloaded = () => {};
		const reload = new Promise<void>((resolve) => {
			reloaded = resolve;
		});
		const server = await createServer({
			root: dir,
			configFile: false,
			logLevel: "silent",
			// Vite's watcher leaves the output alone, as before it reports the files: until then, its
			// resolver keeps the lookup the page made while the compile failed.
			server: { watch: { ignored: [...fixtures.ignored, "**/out/**"] } },
			plugins: [
				grai(),
				{
					name: "reload",
					configureServer(vite) {
						const hot = vite.environments.client.hot;
						const send = hot.send.bind(hot);
						hot.send = (payload: HotPayload | string, data?: unknown) => {
							if (typeof payload === "string") return send(payload, data);
							if (payload.type === "full-reload") reloaded();
							send(payload);
						};
					},
				},
			],
		});
		onTestFinished(() => server.close());
		const page = () => server.environments.client.transformRequest("/main.js");
		await expect(page()).rejects.toThrow(/Failed to resolve/);

		fixed(dir, "Überschrift");
		await reload;
		const { code = "" } = (await page()) ?? {};

		expect([
			code.includes('"/out/messages.js"'),
			code.includes('"/out/runtime.js"'),
		]).toEqual([true, true]);
	});

	it("takes the error down for a page that connects after the fix", async () => {
		const { dir } = project(catalogs);
		const { server, sent, browser } = await devServer(dir);
		await expect
			.poll(() => existsSync(join(dir, "out", "messages.js")), devWait)
			.toBe(true);
		broken(dir);
		await expect.poll(() => sent.includes("error"), devWait).toBe(true);
		const errors = sent.length;
		fixed(dir, "Überschrift");
		await expect.poll(() => sent.length > errors, devWait).toBe(true);

		// A page gets its payloads in order, so by the time its ping is answered it has handled what
		// the server kept for it.
		server.ws.on("test:ping", (_data, client) => client.send("test:pong"));
		const shown = new Promise((resolve) => server.ws.on("test:shown", resolve));
		const page = await browser.newPage();
		// Only until it commits: the reload kept for the page can come before its load event.
		await page.goto(server.resolvedUrls?.local[0] ?? "", {
			waitUntil: "commit",
		});

		expect(await shown).toEqual(["Überschrift", true]);
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
