import { execFile, spawnSync } from "node:child_process";
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { recompile } from "../src/compile.ts";
import { withoutContentHash } from "../src/content-names.ts";
import { outputFile, project } from "./project.ts";
import { messagesOf } from "./reader.ts";

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}" },
	de: { title: "Titel", greeting: "Hallo {name}" },
};

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
		"keys/0.d.ts.map",
		"config.js",
		"runtime.js",
		"runtime.d.ts",
		"server.js",
		"server.d.ts",
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
		"?? grai.config.json\n?? messages/de.json\n?? messages/en.json\n",
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
	// A copy of the compiler, in a process of its own as a new version would run.
	const compiler = join(dir, "grai");
	cpSync(fileURLToPath(new URL("../src", import.meta.url)), compiler, {
		recursive: true,
	});
	const compile = () => {
		const run = spawnSync(
			process.execPath,
			[
				"--input-type=module",
				"-e",
				"const { compile } = await import(process.argv[1]); console.log(JSON.stringify((await compile(process.argv[2])).written));",
				join(compiler, "index.ts"),
				config,
			],
			{ encoding: "utf8" },
		);
		const written: string[] = JSON.parse(run.stdout);
		return written.map(withoutContentHash);
	};
	expect(compile()).toContain("runtime.d.ts");
	expect(compile()).toEqual([]);

	const declarations = join(compiler, "declarations.ts");
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

it("lets two compiles in one process write one outdir, one after the other", async () => {
	for (let trial = 0; trial < 10; trial++) {
		const { compile } = project(catalogs);
		const results = await Promise.all([compile(), compile()]);

		expect(results.map((result) => result.errors)).toEqual([[], []]);
	}
});

it("lets one writer at a time write, when several processes compile at once", async () => {
	for (let trial = 0; trial < 3; trial++) {
		const { config, load } = project(catalogs);
		const errors = await Promise.all(
			[1, 2, 3].map(() => compileElsewhere(config)),
		);

		expect(errors).toEqual([[], [], []]);
		expect((await load()).m.title?.()).toBe("Title");
	}
});

it("refuses a lock whose writer is gone, in every process, and says which file to delete", async () => {
	const { dir, config, compile } = project(catalogs);
	const lock = join(dir, "out", ".grai", "lock");
	mkdirSync(dirname(lock), { recursive: true });
	const gone = String(spawnSync(process.execPath, ["-e", ""]).pid);
	writeFileSync(lock, gone);

	const errors = await Promise.all(
		[1, 2, 3].map(() => compileElsewhere(config)),
	);
	const [refused] = (await compile()).errors;

	expect(errors).toEqual([
		["output-locked"],
		["output-locked"],
		["output-locked"],
	]);
	expect(refused?.message).toContain(`delete ${lock}`);
	expect(readFileSync(lock, "utf8")).toBe(gone);
});

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
