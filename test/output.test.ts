import { execFile, spawnSync } from "node:child_process";
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
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { recompile } from "../src/compile.ts";
import { withoutContentHash } from "../src/content-names.ts";
import { readManifest } from "../src/manifest.ts";
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
 * own: a compile of the project, and what it wrote, each file by its name without the hash of its
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
	return { compiler, extension, compile, start };
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
		"keys/0.d.ts.map",
		"internal.js",
		"internal.d.ts",
		"runtime.js",
		"runtime.d.ts",
		"server.js",
		"server.d.ts",
		"testing.js",
		"testing.d.ts",
		"keys.js",
		"keys.d.ts",
		"messages.js",
		"messages.d.ts",
	]);

	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogs.de, title: "Überschrift" }),
	);
	expect(await writtenBy(compile())).toEqual([
		"keys/0.js",
		"keys/0.d.ts",
		"keys/0.d.ts.map",
		"keys.js",
		"keys.d.ts",
	]);
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
	"compiles again when a module a compile runs changes, and not when another of grai's modules does",
	processTest,
	async () => {
		const { dir, config } = project(catalogs);
		const { compiler, compile } = graiCopy(dir, config);
		const compiledFor = async () => {
			compile();
			return (await readManifest(join(dir, "out", ".grai")))?.inputs;
		};
		const first = await compiledFor();
		appendFileSync(join(compiler, "cli.ts"), "\n");
		const afterCli = await compiledFor();
		appendFileSync(join(compiler, "pattern.ts"), "\n");

		expect(afterCli).toBe(first);
		expect(await compiledFor()).not.toBe(first);
	},
);

it(
	"compiles again when any of grai's modules changes, once a module a compile runs imports a path no literal gives",
	processTest,
	async () => {
		const { dir, config } = project(catalogs);
		const { compiler, compile } = graiCopy(dir, config);
		appendFileSync(
			join(compiler, "modules.ts"),
			'\nexport const later = (name: string) => import("./" + name + ".ts");\n',
		);
		const compiledFor = async () => {
			compile();
			return (await readManifest(join(dir, "out", ".grai")))?.inputs;
		};
		const first = await compiledFor();
		appendFileSync(join(compiler, "cli.ts"), "\n");

		expect(await compiledFor()).not.toBe(first);
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
			// The generator alone changes: each locale's arrow function opens with a comment.
			const generator = join(compiler, `locale-function${extension}`);
			const arrow = ") => $";
			expect(readFileSync(generator, "utf8").split(arrow)).toHaveLength(2);
			writeFileSync(
				generator,
				readFileSync(generator, "utf8").replace(arrow, ") => /* patched */ $"),
			);

			expect([...taken, start()]).toEqual([false, true, false]);
			expect(outputHolds(dir, "/* patched */")).toBe(true);
		},
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
