import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { type FileFacts, factsOf, usesFrom } from "../src/code/facts.ts";
import { keptFacts, readerVersion } from "../src/code/facts-cache.ts";
import { factsOfFiles, workerStart } from "../src/code/facts-pool.ts";
import { Pool, workersFor } from "../src/code/pool.ts";
import { type ProjectCode, readProjectCode } from "../src/code/project.ts";
import { projectResolution, resolverFor } from "../src/code/resolution.ts";
import { type Config, readConfig } from "../src/config.ts";
import { GraiError } from "../src/error.ts";

/** A project on disk with these files, and its config. */
function projectWith(files: Record<string, string>) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-modules-")));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const all = {
		"grai.config.json": JSON.stringify({
			locales: ["en"],
			baseLocale: "en",
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
		"messages/en.json": JSON.stringify({ title: "Title" }),
		"out/messages.js": 'export * as m from "./keys.js";\n',
		"out/keys.js": 'export const title = () => "Title";\n',
		...files,
	};
	for (const [path, text] of Object.entries(all)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	return { dir, config: readConfig(join(dir, "grai.config.json")) };
}

/** A project's code, which the test expects to resolve. */
async function codeOf(config: Config, dir: string): Promise<ProjectCode> {
	const code = await readProjectCode(config, [join(dir, "src")]);
	if (code instanceof GraiError) throw code;
	return code;
}

/** The paths a facts cache holds, from its lines after the version's. */
function cachedPaths(cache: string): string[] {
	return entriesOf(cache).map(([path]) => path);
}

/** A facts cache's entries: each file's path, its text's hash and its facts' text. */
function entriesOf(cache: string): [string, string, string][] {
	return readFileSync(cache, "utf8")
		.split("\n")
		.slice(1)
		.filter((line) => line !== "")
		.map((line) => {
			const [path = "", hash = "", ...kept] = line.split("\t");
			return [JSON.parse(path), hash, kept.join("\t")];
		});
}

/** A facts cache with `facts` in place of each entry `planted` picks, written as a save writes it. */
function planted(
	cache: string,
	picks: (path: string) => boolean,
	facts: unknown,
): string {
	const [version] = readFileSync(cache, "utf8").split("\n");
	const lines = entriesOf(cache).map(
		([path, hash, kept]) =>
			`${JSON.stringify(path)}\t${hash}\t${picks(path) ? JSON.stringify(facts) : kept}`,
	);
	return `${[version, ...lines].join("\n")}\n`;
}

/** Facts with each module's uses parsed from what the cache kept, as a reading parses them. */
function parsed(facts: FileFacts): FileFacts {
	if ("error" in facts) return facts;
	for (const { uses } of facts.modules) {
		for (const origin of Object.keys(uses)) usesFrom(uses, origin);
	}
	return facts;
}

describe("the module graph", () => {
	it("follows a name through re-exports, aliases and namespace objects, resolved as the bundler resolves them", async () => {
		const { dir, config } = projectWith({
			"package.json": JSON.stringify({
				imports: {
					"#i18n/messages/*": "./out/keys.js",
					"#lib/*": "./src/lib/*",
				},
			}),
			".svelte-kit/tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "$lib/*": ["../src/lib/*"] } },
			}),
			"tsconfig.json": JSON.stringify({
				extends: "./.svelte-kit/tsconfig.json",
			}),
			"src/lib/i18n.ts": 'export { m } from "../../out/messages.js";\n',
			"src/lib/explicit.ts":
				'export * from "./i18n.ts";\nexport const m = 2;\n',
			"src/lib/star.ts": 'export * from "./i18n.ts";\n',
			"src/lib/alias.ts":
				'import { m } from "./i18n.ts";\nexport const t = m;\nexport default m;\n',
			"src/lib/object.ts":
				'export * as messages from "../../out/messages.js";\n',
			"src/app.ts": "",
		});
		writeFileSync(
			join(dir, "vite.config.js"),
			`export default { resolve: { alias: { "@i18n": ${JSON.stringify(join(dir, "src/lib/i18n.ts"))} } } };\n`,
		);
		const { graph } = await codeOf(config, dir);
		const app = join(dir, "src/app.ts");
		const of = (source: string, name: string) =>
			graph.imported(app, source, name);

		expect(await of("#lib/i18n.ts", "m")).toEqual({ kind: "namespace" });
		expect(await of("$lib/i18n.ts", "m")).toEqual({ kind: "namespace" });
		expect(await of("@i18n", "m")).toEqual({ kind: "namespace" });
		expect(await of("#i18n/messages/title.js", "title")).toEqual({
			kind: "key",
			key: "title",
		});
		// A key's path is that key's module alone, as a build resolves it: through keys.js, its
		// namespace object would hold every key.
		const own = await of("#i18n/messages/title.js", "*");
		expect(own).toEqual({ kind: "module", path: "\0grai:key/title" });
		expect(await of("#i18n/messages/title.js", "subtitle")).toBeUndefined();
		expect(
			own === undefined ? undefined : await graph.member(own, "subtitle"),
		).toBeUndefined();
		expect(await of("./lib/star.ts", "m")).toEqual({ kind: "namespace" });
		expect(await of("./lib/explicit.ts", "m")).toBeUndefined();
		expect(await of("./lib/alias.ts", "t")).toEqual({ kind: "namespace" });
		expect(await of("./lib/alias.ts", "default")).toEqual({
			kind: "namespace",
		});
		const object = await of("./lib/object.ts", "messages");
		expect(object).toEqual({
			kind: "module",
			path: join(dir, "out/messages.js"),
		});
		expect(
			object === undefined ? undefined : await graph.member(object, "m"),
		).toEqual({ kind: "namespace" });
		expect(await of("./lib/missing.ts", "m")).toBeUndefined();
	});
});

describe("resolving as the bundler resolves", () => {
	it("applies the project's tsconfig paths to a component its include does not list, as the framework's bundler does", async () => {
		const { dir, config } = projectWith({
			"tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "@/*": ["./src/*"] } },
				include: ["src/**/*.ts"],
			}),
			"src/lib/i18n.ts": 'export { m } from "../../out/messages.js";\n',
			"src/app.ts": "",
		});
		const { graph } = await codeOf(config, dir);

		for (const importer of ["src/app.ts", "src/A.svelte", "src/a.astro"]) {
			expect(
				await graph.imported(join(dir, importer), "@/lib/i18n.ts", "m"),
			).toEqual({ kind: "namespace" });
		}
	});

	it("resolves a Nuxt page by the tsconfig Nuxt generates, which the project's tsconfig references", async () => {
		const nuxt = {
			"tsconfig.json": JSON.stringify({
				files: [],
				references: [{ path: "./.nuxt/tsconfig.app.json" }],
			}),
			"app/pages/index.vue":
				'<script setup lang="ts">\nimport * as m from "~/out/keys.js";\n</script>\n<template><h1>{{ m.title() }}</h1></template>\n',
		};
		const prepared = projectWith({
			...nuxt,
			".nuxt/tsconfig.app.json": JSON.stringify({
				compilerOptions: { paths: { "~/*": ["../*"] } },
				// As Nuxt writes it: a component is listed by its extension.
				include: ["../app/**/*", "../app/**/*.vue"],
			}),
		});
		const unprepared = projectWith(nuxt);
		const code = await readProjectCode(prepared.config, [
			join(prepared.dir, "app"),
		]);
		if (code instanceof GraiError) throw code;
		const unresolved = await readProjectCode(unprepared.config, [
			join(unprepared.dir, "app"),
		]);

		expect(
			await code.graph.imported(
				join(prepared.dir, "app/pages/index.vue"),
				"~/out/keys.js",
				"*",
			),
		).toEqual({ kind: "namespace" });
		expect(unresolved instanceof GraiError ? unresolved.code : "resolved").toBe(
			"resolution-invalid",
		);
	});

	it("fails, naming the config, when the tsconfig extends a file not generated yet or the Vite config does not load", async () => {
		const unsynced = projectWith({
			"tsconfig.json": JSON.stringify({
				extends: "./.svelte-kit/tsconfig.json",
			}),
			"src/app.ts": 'import { m } from "../out/messages.js";\n',
		});
		const broken = projectWith({
			"vite.config.js":
				'import plugin from "./missing-plugin.js";\nexport default { plugins: [plugin()] };\n',
			"src/app.ts": "",
		});

		const failure = async ({ dir, config }: typeof unsynced) => {
			const code = await readProjectCode(config, [join(dir, "src")]);
			return code instanceof GraiError
				? `${code.code}: ${code.file}`
				: "resolved";
		};
		expect(await failure(unsynced)).toBe("resolution-invalid: tsconfig.json");
		expect(await failure(broken)).toBe("resolution-invalid: vite.config.js");
	});
});

describe("reading a project's facts", () => {
	it("keeps each file's facts on disk, takes them while its text is the same, and drops a file gone", async () => {
		const { dir, config } = projectWith({
			"src/a.ts": 'import { m } from "../out/messages.js";\nm.title();\n',
			"src/b.ts": "export const b = 1;\n",
		});
		const cache = join(dir, "out/.grai/facts");
		await codeOf(config, dir);
		expect(cachedPaths(cache).sort()).toEqual([
			join(dir, "src/a.ts"),
			join(dir, "src/b.ts"),
		]);

		// A cached entry stands for its file while the file's text is the one it was read from.
		const plantedFacts = {
			modules: [
				{
					imports: [],
					exports: [{ exported: "planted", local: "planted" }],
					loads: [],
					uses: {},
					aliases: {},
				},
			],
		};
		writeFileSync(
			cache,
			planted(cache, (path) => path.endsWith("b.ts"), plantedFacts),
		);
		rmSync(join(dir, "src/a.ts"));
		const { sources } = await codeOf(config, dir);

		expect(sources.get(join(dir, "src/b.ts"))?.facts).toEqual(plantedFacts);
		expect(cachedPaths(cache)).toEqual([join(dir, "src/b.ts")]);
	});

	it("keys the facts on the reader's own code, so a change to it reads every file again, released or not", () => {
		const { dir } = projectWith({
			"reader/facts.js": "export const facts = 1;\n",
			"reader/uses.js": "export const uses = 1;\n",
		});
		const reader = join(dir, "reader");
		const before = readerVersion(reader);

		expect(readerVersion(reader)).toBe(before);
		writeFileSync(join(reader, "uses.js"), "export const uses = 2;\n");
		expect(readerVersion(reader)).not.toBe(before);
	});

	it("takes every file's facts from the cache on a reading after one that changed nothing, and writes nothing", async () => {
		const { dir, config } = projectWith({
			"src/a.ts": 'import { m } from "../out/messages.js";\nm.title();\n',
			"src/b.ts": "export const b = 1;\n",
		});
		const cache = join(dir, "out/.grai/facts");
		await codeOf(config, dir);
		// Facts no reading would give, so a file read again shows.
		const empty = { modules: [] };
		writeFileSync(
			cache,
			planted(cache, () => true, empty),
		);
		// A save writes a new file in its place, so the same file is one never written again.
		const file = statSync(cache).ino;

		const { sources } = await codeOf(config, dir);

		expect([...sources.values()].map(({ facts }) => facts)).toEqual([
			empty,
			empty,
		]);
		expect(statSync(cache).ino).toBe(file);
	});

	it("sizes the pool by the work left: no worker for a little, one for each worker's start of it, at most the parallelism less one", () => {
		// The reading has taken a worker's start, a millisecond for each file read.
		const after = workerStart + 1;
		const workers = (left: number, parallelism = 8) =>
			workersFor(workerStart, after, after, left, parallelism);

		expect(
			[400, 600, 1_000, 1_500, 100_000].map((left) => workers(left)),
		).toEqual([0, 2, 4, 6, 7]);
		expect(workers(100_000, 2)).toBe(0);
		// Before a worker's start has passed, the reading goes on here whatever is left.
		expect(workersFor(workerStart, workerStart, workerStart, 100_000, 8)).toBe(
			0,
		);
	});

	it("reads files in workers into the same facts as on one thread, each in its place", async () => {
		// Files enough for tasks of their own, which the two workers share.
		const files = [
			...Array.from({ length: 8 }, (_, n) => ({
				path: `src/m${n}.ts`,
				text: `import { m } from "./i18n";\n${"m.title();\n".repeat(4_000 + n)}export const v${n} = 1;\n`,
			})),
			{
				path: "src/App.svelte",
				text: '<script>\n\timport { m } from "./i18n";\n</script>\n<h1>{m.title()}</h1>\n',
			},
		];
		const inline = [];
		for (const { path, text } of files) inline.push(await factsOf(path, text));

		const pool = new Pool();
		onTestFinished(() => pool.close());
		pool.start(2);
		const read = await factsOfFiles(files, pool, false);

		expect(read.map(({ facts }) => parsed(facts))).toEqual(inline);
		expect(read.map(({ kept }) => parsed(keptFacts(kept)))).toEqual(inline);
	});

	it("resolves imports in a worker as this thread does, an empty path for one that names no file", async () => {
		const { dir } = projectWith({
			"package.json": JSON.stringify({ imports: { "#lib/*": "./src/lib/*" } }),
			"tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "$lib/*": ["./src/lib/*"] } },
			}),
			"src/lib/i18n.ts": 'export { m } from "../../out/messages.js";\n',
			"src/a.ts": "export const a = 1;\n",
		});
		const resolution = await projectResolution(dir);
		if (resolution instanceof GraiError) throw resolution;
		const importer = join(dir, "src/a.ts");
		const imports = [
			"#lib/i18n.ts",
			"$lib/i18n",
			"./missing.js",
			"../out/keys.js",
		].map((source) => ({ source, importer }));
		const pool = new Pool();
		onTestFinished(() => pool.close());
		pool.start(1);
		const resolve = resolverFor(resolution);

		const [paths] = await pool.run(
			[{ kind: "resolve", resolution, imports }],
			{
				here: async () => [],
				there: (answer) => answer,
				size: (task) => task.imports.length,
				start: 0,
			},
			false,
		);

		expect(paths).toEqual(
			imports.map(({ source }) => resolve(source, importer) ?? ""),
		);
		expect(paths).toEqual([
			join(dir, "src/lib/i18n.ts"),
			join(dir, "src/lib/i18n.ts"),
			"",
			join(dir, "out/keys.js"),
		]);
	});
});
