import { execFile, spawn, spawnSync } from "node:child_process";
import { hash } from "node:crypto";
import {
	appendFileSync,
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { compileProject, recompile, writeBuild } from "../src/compile.ts";
import { withoutContentHash } from "../src/content-names.ts";
import { readManifest } from "../src/manifest.ts";
import { isCompiled } from "../src/output-inputs.ts";
import { writeUndeclared } from "../src/undeclared.ts";
import {
	isDeclarations,
	outputTexts,
	unresolvedImports,
} from "./output-files.ts";
import { outputFile, project } from "./project.ts";
import { messagesOf } from "./reader.ts";

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}" },
	de: { title: "Titel", greeting: "Hallo {name}" },
};

/**
 * A test's budget when it starts compiler processes: on a loaded machine each new process takes a
 * second or more to load grai, so a test of several outlasts Vitest's 5 s.
 */
const processTest = { timeout: 60_000 };

/** Compiles a project in a process of its own, as another grai would, and gives its errors' codes. */
async function compileElsewhere(config: string): Promise<string[]> {
	const { stdout } = await promisify(execFile)(process.execPath, [
		"--input-type=module",
		"-e",
		"const { compile } = await import(process.argv[1]); console.log(JSON.stringify((await compile(process.argv[2])).errors.map((error) => error.code)));",
		fileURLToPath(new URL("../src/index.ts", import.meta.url)),
		config,
	]);
	return JSON.parse(stdout);
}

function modified(dir: string): Record<string, number> {
	const out = join(dir, "out");
	return Object.fromEntries(
		readdirSync(out).map((file) => [file, statSync(join(out, file)).mtimeMs]),
	);
}

/**
 * A copy of grai in the project, its source or its build (`dist`, which the gate builds before the
 * tests), for a test to change as a new version, a local build or a patch would, with its modules'
 * extension; the packages it imports resolve from the project. Each run of it is a process of its
 * own, of a script given `grai`'s URL, the `config` and the `extension`, which prints its result as
 * JSON: a compile of the project, and what it wrote, each file by its name without the hash of its
 * content; and a dev server's start, which takes up the saved build, compiles from it and saves its
 * build, and whether it took one up.
 */
function graiCopy(dir: string, config: string, layout: "src" | "dist" = "src") {
	const compiler = join(dir, "grai");
	cpSync(fileURLToPath(new URL(`../${layout}`, import.meta.url)), compiler, {
		recursive: true,
	});
	symlinkSync(
		fileURLToPath(new URL("../node_modules", import.meta.url)),
		join(dir, "node_modules"),
		"junction",
	);
	const extension = layout === "src" ? ".ts" : ".js";
	const run = (script: string): unknown => {
		const ran = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				`const [grai, config, extension] = process.argv.slice(1);\n${script}`,
				pathToFileURL(compiler).href,
				config,
				extension,
			],
			{ encoding: "utf8" },
		);
		expect(ran.stderr).toBe("");
		return JSON.parse(ran.stdout);
	};
	const compile = () =>
		(
			run(
				'const { compile } = await import(grai + "/index" + extension); console.log(JSON.stringify((await compile(config)).written));',
			) as string[]
		).map(withoutContentHash);
	const start = () =>
		run(`const { recompile } = await import(\`\${grai}/compile\${extension}\`);
const { saveBuild, savedBuild } = await import(\`\${grai}/saved-build\${extension}\`);
const options = { pseudoLocale: true };
const saved = await savedBuild(config, options);
await saveBuild((await recompile(config, saved, options)).build);
console.log(JSON.stringify(saved !== undefined));`) as boolean;
	return { compiler, extension, run, compile, start };
}

/** Whether a file of the output holds a text. */
function outputHolds(dir: string, text: string): boolean {
	const out = join(dir, "out");
	return readdirSync(out, { recursive: true, encoding: "utf8" }).some(
		(file) =>
			statSync(join(out, file)).isFile() &&
			readFileSync(join(out, file), "utf8").includes(text),
	);
}

/** What a compile wrote, each file by its name without the hash of its content. */
async function writtenBy(compiled: Promise<{ written: string[] }>) {
	return (await compiled).written.map(withoutContentHash);
}

it("writes the whole output once, then only the files an edit changes", async () => {
	const { dir, compile } = project(catalogs);
	expect(await writtenBy(compile())).toEqual([
		"config.js",
		"runtime.js",
		"runtime.d.ts",
		"plurals.js",
		"keys/0.js",
		"keys/0.d.ts",
		".gitignore",
		"package.json",
		"internal.js",
		"internal.d.ts",
		"runtime.js",
		"runtime.d.ts",
		"server.js",
		"server.d.ts",
		"testing.js",
		"testing.d.ts",
		"messages.js",
		"messages.d.ts",
		"keys/0.d.ts.map",
		"keys.js",
		"keys.d.ts",
	]);

	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogs.de, title: "Überschrift" }),
	);
	expect(await writtenBy(compile())).toEqual(["keys/0.js"]);
});

/** A project's keys compiled without their declarations, as a dev server's first compile leaves them. */
async function compiledUndeclared(config: string) {
	const compiled = await compileProject(config, undefined, { declare: false });
	if ("errors" in compiled) throw compiled.errors[0];
	return compiled;
}

it("writes the same output in two steps, every module whole and then the declarations and their maps, as in one, and no module twice", async () => {
	const many = {
		en: {
			...catalogs.en,
			items: "{n :number} items",
			link: "{#a}Open{/a}",
		},
		de: {
			...catalogs.de,
			items: "{n :number} Teile",
			link: "{#a}Öffnen{/a}",
		},
	};
	const once = project(many);
	expect((await once.compile()).errors).toEqual([]);
	const { dir, config } = project(many);
	const compiled = await compiledUndeclared(config);
	const out = join(dir, "out");

	const first = await writeUndeclared(compiled);

	expect(first.result.errors).toEqual([]);
	expect(first.result.written.filter(isDeclarations)).toEqual([]);
	expect([...outputTexts(out).keys()].filter(isDeclarations)).toEqual([]);
	expect(unresolvedImports(out)).toEqual([]);
	expect(await isCompiled(config)).toBe(false);

	const then = await writeBuild(compiled, undefined, {
		undeclared: first.undeclared,
	});

	expect(then.result.errors).toEqual([]);
	expect(then.result.written.length).toBeGreaterThan(0);
	expect(then.result.written.filter((file) => !isDeclarations(file))).toEqual(
		[],
	);
	expect(outputTexts(out)).toEqual(outputTexts(join(once.dir, "out")));
	expect(await isCompiled(config)).toBe(true);
});

/** Each module of the output, with its text and when it was last written. */
function modulesIn(out: string): Map<string, [string, number]> {
	return new Map(
		[...outputTexts(out)]
			.filter(([file]) => file.endsWith(".js"))
			.map(([file, text]) => [file, [text, statSync(join(out, file)).mtimeMs]]),
	);
}

it("completes no output written without its declarations once another write has replaced it, whichever completion comes first", async () => {
	for (const replacedFirst of [false, true]) {
		const { dir, config } = project(catalogs);
		const out = join(dir, "out");
		// Two writers of the outdir, as two watchers are, each placing the keys its own way.
		const shards = await compiledUndeclared(config);
		const byShards = await writeUndeclared(shards);
		const grouped = await compiledUndeclared(config);
		const byGroups = await writeUndeclared(grouped, {
			placing: async () => ({
				groups: Promise.resolve([["title"]]),
				waited: true,
			}),
		});
		const completeShards = () =>
			writeBuild(shards, undefined, { undeclared: byShards.undeclared });
		const completeGroups = () =>
			writeBuild(grouped, undefined, { undeclared: byGroups.undeclared });

		if (!replacedFirst)
			expect((await completeGroups()).result.errors).toEqual([]);
		const before = modulesIn(out);
		const superseded = await completeShards();
		expect(superseded).toEqual({ result: { written: [], errors: [] } });
		expect(modulesIn(out)).toEqual(before);
		if (replacedFirst)
			expect((await completeGroups()).result.errors).toEqual([]);

		expect(
			[...modulesIn(out).keys()].some((file) => /^keys\/g0-.+\.js$/.test(file)),
		).toBe(true);
		expect(await isCompiled(config)).toBe(true);
	}
});

it("records each file it replaces by the hash of the text it wrote, a module of keys' and its declarations' taken as they were rendered", async () => {
	const { dir, compile } = project(catalogs);
	expect((await compile()).errors).toEqual([]);
	const out = join(dir, "out");

	const manifest = await readManifest(join(out, ".grai"));

	const recorded = Object.entries(manifest?.mutable ?? {});
	expect(recorded.some(([file]) => /^keys\/[^/]+\.d\.ts$/.test(file))).toBe(
		true,
	);
	for (const [file, recordedHash] of recorded)
		expect([file, recordedHash]).toEqual([
			file,
			hash("sha1", readFileSync(join(out, file), "utf8")),
		]);
});

it("takes no output written without its declarations for the output of its catalogs, so the next compile writes them, and them alone", async () => {
	const { config, compile } = project(catalogs);
	await writeUndeclared(await compiledUndeclared(config));

	const { written, errors } = await compile();

	expect(errors).toEqual([]);
	expect(written.length).toBeGreaterThan(0);
	expect(written.filter((file) => !isDeclarations(file))).toEqual([]);
	expect(await isCompiled(config)).toBe(true);
});

it("has Git ignore the output, and nothing else", async () => {
	const { dir, compile } = project(catalogs);
	await compile();
	const git = (...args: string[]) =>
		spawnSync("git", args, { cwd: dir, encoding: "utf8" }).stdout;
	git("init", "--quiet");

	expect(git("status", "--porcelain", "--untracked-files=all")).toBe(
		"?? grai.config.json\n?? messages/de.json\n?? messages/en.json\n?? package.json\n?? tsconfig.json\n",
	);
});

it("touches nothing when the catalogs and config are those of the output", async () => {
	const { dir, compile } = project(catalogs);
	await compile();
	const before = modified(dir);

	expect((await compile()).written).toEqual([]);
	expect(modified(dir)).toEqual(before);
});

it("writes the output again when grai itself changes, as an upgrade or a local build changes it", async () => {
	const { dir, config } = project(catalogs);
	const { compiler, compile } = graiCopy(dir, config);
	expect(compile()).toContain("runtime.d.ts");
	expect(compile()).toEqual([]);

	const declarations = join(compiler, "runtime", "runtime.d.ts.template");
	writeFileSync(
		declarations,
		readFileSync(declarations, "utf8").replace(
			"One of the project's locales.",
			"A locale of the project.",
		),
	);

	expect(compile()).toContain("runtime.d.ts");
	expect(readFileSync(await outputFile(dir, "runtime.d.ts"), "utf8")).toContain(
		"A locale of the project.",
	);
});

it(
	"compiles again when a module a compile runs changes, and not when another of grai's modules does, as built",
	processTest,
	async () => {
		const { dir, config } = project(catalogs);
		const { compiler, compile } = graiCopy(dir, config, "dist");
		const compiledFor = async () => {
			compile();
			return (await readManifest(join(dir, "out", ".grai")))?.inputs;
		};
		const first = await compiledFor();
		appendFileSync(join(compiler, "cli.js"), "\n");
		const afterCli = await compiledFor();
		appendFileSync(join(compiler, "pattern.js"), "\n");

		expect(afterCli).toBe(first);
		expect(await compiledFor()).not.toBe(first);
	},
);

it(
	"finds the compiler's modules no more once one imports a path no literal gives, which fails grai's build",
	processTest,
	() => {
		const { dir, config } = project(catalogs);
		const { compiler, run } = graiCopy(dir, config);
		const unfound = () =>
			run(
				'const { compilerModules } = await import(grai + "/compiler-modules" + extension); console.log(JSON.stringify((await compilerModules()) === undefined));',
			);
		const before = unfound();
		appendFileSync(
			join(compiler, "modules.ts"),
			'\nexport const later = (name: string) => import("./" + name + ".ts");\n',
		);

		expect([before, unfound()]).toEqual([false, true]);
	},
);

for (const layout of ["src", "dist"] as const) {
	it(
		`takes up no saved build once a module a compile imports changes, however its import is written, in grai's ${layout}`,
		processTest,
		() => {
			const { dir, config } = project(catalogs);
			const { compiler, extension, start } = graiCopy(dir, config, layout);
			// The import of the compiler's generator in single quotes, as a patch may write it.
			const modules = join(compiler, `modules${extension}`);
			const imported = `from "./locale-function${extension}"`;
			expect(readFileSync(modules, "utf8")).toContain(imported);
			writeFileSync(
				modules,
				readFileSync(modules, "utf8").replace(
					imported,
					`from './locale-function${extension}'`,
				),
			);
			const taken = [start(), start()];
			patchGenerator(compiler, extension);

			expect([...taken, start()]).toEqual([false, true, false]);
			expect(outputHolds(dir, "/* patched */")).toBe(true);
		},
	);

	it(
		`saves a build as the compiler that compiled it, though its modules change before the save, in grai's ${layout}`,
		processTest,
		async () => {
			const { dir, config } = project(catalogs);
			const { compiler, extension, start } = graiCopy(dir, config, layout);
			// A dev server's first start: it serves its page from the compile, and writes and saves the
			// build once it is quiet, here once told to.
			const script = `const [grai, config, extension] = process.argv.slice(1);
const { compileProject, writeBuild } = await import(grai + "/compile" + extension);
const { saveBuild } = await import(grai + "/saved-build" + extension);
const { createInterface } = await import("node:readline");
const compiled = await compileProject(config, undefined, { pseudoLocale: true, declare: false });
console.log("compiled");
for await (const _ of createInterface({ input: process.stdin })) break;
await saveBuild((await writeBuild(compiled)).build);
console.log("saved");`;
			const serving = spawn(
				process.execPath,
				[
					"--input-type=module",
					"-e",
					script,
					pathToFileURL(compiler).href,
					config,
					extension,
				],
				{ stdio: ["pipe", "pipe", "pipe"] },
			);
			let errors = "";
			serving.stderr.on("data", (chunk) => {
				errors += chunk;
			});
			const lines = createInterface({ input: serving.stdout });
			const said = (line: string) =>
				new Promise<void>((resolve, reject) => {
					lines.on("line", (got) => {
						if (got === line) resolve();
					});
					serving.on("close", () => reject(new Error(errors)));
				});
			const compiled = said("compiled");
			const saved = said("saved");
			await compiled;
			patchGenerator(compiler, extension);
			serving.stdin.end("save\n");
			await saved;

			expect(start()).toBe(false);
			expect(outputHolds(dir, "/* patched */")).toBe(true);
		},
	);
}

/** Changes the compiler's generator alone: each locale's arrow function opens with a comment. */
function patchGenerator(compiler: string, extension: string): void {
	const generator = join(compiler, `locale-function${extension}`);
	const arrow = ") => $";
	expect(readFileSync(generator, "utf8").split(arrow)).toHaveLength(2);
	writeFileSync(
		generator,
		readFileSync(generator, "utf8").replace(arrow, ") => /* patched */ $"),
	);
}

it("writes the declaration maps again when the config moves the catalog they point to", async () => {
	const { dir, config, compile } = project(catalogs);
	await compile();
	mkdirSync(join(dir, "moved"));
	for (const locale of Object.keys(catalogs)) {
		cpSync(
			join(dir, "messages", `${locale}.json`),
			join(dir, "moved", `${locale}.json`),
		);
	}
	writeFileSync(
		config,
		JSON.stringify({
			...JSON.parse(readFileSync(config, "utf8")),
			catalogs: "moved/{locale}.json",
		}),
	);

	expect(await writtenBy(compile())).toEqual(["keys/0.d.ts.map"]);
	const map = readFileSync(join(dir, "out", "keys", "0.d.ts.map"), "utf8");
	expect(JSON.parse(map).sources).toEqual(["../../moved/en.json"]);
});

it("writes a file of the output again when it is missing", async () => {
	const { dir, compile } = project(catalogs);
	await compile();
	rmSync(join(dir, "out", "keys.js"));

	expect((await compile()).written).toEqual(["keys.js"]);
});

it("writes what an edit needs, though another writer changed the output after this build was made", async () => {
	const { dir, config, compile } = project(catalogs);
	const catalog = join(dir, "messages", "en.json");
	const first = await recompile(config, undefined);
	writeFileSync(catalog, JSON.stringify({ ...catalogs.en, title: "New" }));
	await compile();
	writeFileSync(catalog, JSON.stringify(catalogs.en));
	await recompile(config, first.build);

	expect((await messagesOf(dir)).title?.()).toBe("Title");
	expect((await compile()).written).toEqual([]);
});

it("writes again the files of the output deleted by hand, though the edit does not change them", async () => {
	const { dir, config } = project(catalogs);
	const out = join(dir, "out");
	const first = await recompile(config, undefined);
	for (const file of readdirSync(out))
		if (file.startsWith("runtime") || file === "keys.d.ts")
			rmSync(join(out, file));
	const catalog = join(dir, "messages", "de.json");
	writeFileSync(catalog, JSON.stringify({ ...catalogs.de, title: "Kopf" }));
	await recompile(config, first.build);

	expect((await messagesOf(dir)).title?.({}, { locale: "de" })).toBe("Kopf");
	expect(readdirSync(out)).toContain("keys.d.ts");
});

it("owns its outdir: it removes the files of an earlier layout and of a compile that stopped halfway", async () => {
	const { dir, compile } = project(catalogs);
	const out = join(dir, "out");
	mkdirSync(join(out, "keys"), { recursive: true });
	mkdirSync(join(out, ".grai"), { recursive: true });
	// An outdir as grai wrote it before its modules were named by their content.
	writeFileSync(
		join(out, ".grai", "manifest.json"),
		JSON.stringify({ inputs: "earlier", files: ["keys/0.js", "keys.js"] }),
	);
	writeFileSync(
		join(out, "keys", "0.js"),
		'import { text } from "../runtime.js";\n',
	);
	writeFileSync(join(out, "keys", "0.d.ts"), "export {};\n");
	writeFileSync(join(out, "formats.js"), "export {};\n");
	writeFileSync(join(out, ".grai", "left-by-a-crash.tmp"), "half");

	expect((await compile()).errors).toEqual([]);

	const files = readdirSync(out, { recursive: true, encoding: "utf8" });
	expect(files).not.toContain("formats.js");
	expect(files).not.toContain(join("keys", "0.js"));
	expect(files).not.toContain(join("keys", "0.d.ts"));
	expect(files).not.toContain(join(".grai", "left-by-a-crash.tmp"));
	expect((await messagesOf(dir)).title?.()).toBe("Title");
});

it("refuses an outdir that holds files no compile wrote, and leaves them as they are", async () => {
	const { dir, compile } = project(catalogs);
	mkdirSync(join(dir, "out"));
	writeFileSync(join(dir, "out", "notes.md"), "mine");

	const [refused] = (await compile()).errors;

	expect(refused?.code).toBe("outdir-not-empty");
	expect(readdirSync(join(dir, "out"))).toEqual(["notes.md"]);
});

it("lets two compiles in one process write one outdir, one after the other", async () => {
	for (let trial = 0; trial < 10; trial++) {
		const { compile } = project(catalogs);
		const results = await Promise.all([compile(), compile()]);

		expect(results.map((result) => result.errors)).toEqual([[], []]);
	}
});

it(
	"lets one writer at a time write, when several processes compile at once",
	processTest,
	async () => {
		for (let trial = 0; trial < 3; trial++) {
			const { config, load } = project(catalogs);
			const errors = await Promise.all(
				[1, 2, 3].map(() => compileElsewhere(config)),
			);

			expect(errors).toEqual([[], [], []]);
			expect((await load()).m.title?.()).toBe("Title");
		}
	},
);

it("removes the claims of writers no longer running as it takes the lock", async () => {
	const { dir, compile } = project(catalogs);
	const state = join(dir, "out", ".grai");
	mkdirSync(state, { recursive: true });
	const gone = spawnSync(process.execPath, ["-e", ""]).pid;
	writeFileSync(join(state, `lock.${gone}.left`), String(gone));

	expect((await compile()).errors).toEqual([]);
	expect(readdirSync(state)).not.toContain(`lock.${gone}.left`);
});

it("waits for a live writer's lock before it writes", async () => {
	const { dir, compile } = project(catalogs);
	const state = join(dir, "out", ".grai");
	mkdirSync(state, { recursive: true });
	writeFileSync(join(state, "lock"), String(process.pid));

	const compiling = compile();
	// Its claim beside the lock says it waits.
	await vi.waitFor(() =>
		expect(readdirSync(state).some((name) => name.startsWith("lock."))).toBe(
			true,
		),
	);
	expect(existsSync(join(dir, "out", "keys.js"))).toBe(false);
	rmSync(join(state, "lock"));

	expect((await compiling).written).toContain("keys.js");
});

it("writes output whose every import is a file of the output, or Node's async_hooks", async () => {
	const { dir, compile } = project(catalogs);
	await compile();
	const out = join(dir, "out");
	const imports = readdirSync(out, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".js"))
		.flatMap((file) =>
			[...readFileSync(join(out, file), "utf8").matchAll(/from "([^"]+)"/g)]
				.map(([, specifier = ""]) => specifier)
				.filter((specifier) => specifier !== "node:async_hooks")
				.map((specifier) => resolve(out, dirname(file), specifier)),
		);

	expect(imports.length).toBeGreaterThan(0);
	for (const path of imports) {
		expect(path.startsWith(`${out}/`) && existsSync(path)).toBe(true);
	}
});
