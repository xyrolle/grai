// What grai keeps from one start to the next, against its build as published: the saved build a
// dev server or `grai watch` takes up, and the facts of an app's files a command keeps. Each start
// is a process of its own, of a copy of the build (`dist`, which the gate builds before the tests)
// that a test changes as a patched install would, without its lists of chunks
// (`builtModulesFile`) made again: a chunk the lists leave out, or the compiler's identity taken
// after its code changed, would have a start take up what an older grai kept.
import { spawn, spawnSync } from "node:child_process";
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
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { type BuiltPart, builtModulesFile } from "../src/compiler-identity.ts";
import { project } from "./project.ts";

const processTest = { timeout: 60_000 };

const catalogs = {
	en: { greeting: "Hello {name}", farewell: "Bye {name}" },
	de: { greeting: "Hallo {name}", farewell: "Tschüss {name}" },
};

/** A copy of grai's build in the project, the packages it imports resolving from the repository. */
function builtCopy(dir: string): string {
	const copy = join(dir, "grai");
	cpSync(fileURLToPath(new URL("../dist", import.meta.url)), copy, {
		recursive: true,
	});
	symlinkSync(
		fileURLToPath(new URL("../node_modules", import.meta.url)),
		join(dir, "node_modules"),
		"junction",
	);
	return copy;
}

/** The one module of the copy whose code holds `needle`, by its path in the copy. */
function holding(copy: string, needle: string): string {
	const files = readdirSync(copy, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".js"))
		.filter((file) => readFileSync(join(copy, file), "utf8").includes(needle));
	expect(files).toHaveLength(1);
	return files[0] ?? "";
}

/** The chunks the copy's build lists for a part of grai. */
function listed(copy: string, part: BuiltPart): string[] {
	return Object.keys(
		JSON.parse(readFileSync(join(copy, builtModulesFile), "utf8"))[part],
	);
}

/** Changes the compiler's generator alone: each locale's arrow function opens with a comment. */
function patchGenerator(copy: string): void {
	const arrow = ") => $";
	const generator = join(copy, holding(copy, arrow));
	writeFileSync(
		generator,
		readFileSync(generator, "utf8").replace(arrow, ") => /* patched */ $"),
	);
}

/**
 * `grai watch` from the copy, in a process of its own, until it reports its first compile; with
 * `saved`, until it has saved that build too, which it does once the process is quiet. `reported`
 * runs as the compile is reported, before the save. What it reported.
 */
async function watched(
	copy: string,
	config: string,
	{
		saved = false,
		reported = () => {},
	}: { saved?: boolean; reported?: () => void } = {},
): Promise<string> {
	const build = join(config, "..", "out", ".grai", "build");
	const savedAt = () => (existsSync(build) ? statSync(build).mtimeMs : 0);
	const before = savedAt();
	const watch = spawn(
		process.execPath,
		[join(copy, "cli.js"), "watch", "--config", config],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	let errors = "";
	watch.stderr.on("data", (chunk) => {
		errors += chunk;
	});
	const closed = new Promise<void>((resolve) =>
		watch.once("close", () => resolve()),
	);
	try {
		const report = await new Promise<string>((resolve, reject) => {
			createInterface({ input: watch.stdout }).on("line", (line) => {
				if (line.startsWith("grai: ") && !line.startsWith("grai: watching"))
					resolve(line);
			});
			watch.once("close", () => reject(new Error(errors)));
		});
		reported();
		if (saved)
			await expect
				.poll(() => savedAt() > before, { timeout: 30_000 })
				.toBe(true);
		return report;
	} finally {
		watch.kill();
		await closed;
	}
}

/**
 * A dev server's first start, with the copy's Vite plugin, in a process of its own: once a page's
 * keys are served, from the first compile, `servedPage` runs; then the server runs until the build
 * is saved.
 */
async function served(
	copy: string,
	dir: string,
	config: string,
	servedPage: () => void,
): Promise<void> {
	const build = join(dir, "out", ".grai", "build");
	const script = `import { createServer } from "vite";
const { grai } = await import(${JSON.stringify(pathToFileURL(join(copy, "vite.js")).href)});
const server = await createServer({ root: ${JSON.stringify(dir)}, configFile: false, logLevel: "silent", server: { host: "127.0.0.1", port: 0 }, plugins: [grai({ config: ${JSON.stringify(config)} })] });
await server.listen();
console.log(server.resolvedUrls.local[0]);`;
	writeFileSync(join(dir, "serve.mjs"), script);
	const server = spawn(process.execPath, [join(dir, "serve.mjs")], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	let errors = "";
	server.stderr.on("data", (chunk) => {
		errors += chunk;
	});
	const closed = new Promise<void>((resolve) =>
		server.once("close", () => resolve()),
	);
	try {
		const url = await new Promise<string>((resolve, reject) => {
			createInterface({ input: server.stdout }).once("line", resolve);
			server.once("close", () => reject(new Error(errors)));
		});
		const keys = await fetch(new URL("@id/__x00__grai:keys/de", url));
		expect(await keys.text()).toContain("Hallo");
		expect(existsSync(build)).toBe(false);
		servedPage();
		await expect.poll(() => existsSync(build), { timeout: 30_000 }).toBe(true);
	} finally {
		server.kill();
		await closed;
	}
}

/** How many of the output's files' functions the patched generator wrote. */
function patched(dir: string): number {
	const out = join(dir, "out");
	return readdirSync(out, { recursive: true, encoding: "utf8" })
		.filter((file) => file.endsWith(".js") && !file.startsWith(".grai"))
		.map(
			(file) =>
				readFileSync(join(out, file), "utf8").split("/* patched */").length - 1,
		)
		.reduce((sum, count) => sum + count, 0);
}

/** The output the copy compiles from nothing, in a process of its own, as a reference. */
function patchedFromNothing(copy: string, dir: string, config: string): number {
	rmSync(join(dir, "out"), { recursive: true, force: true });
	const run = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`const { compile } = await import(${JSON.stringify(pathToFileURL(join(copy, "index.js")).href)}); const { errors } = await compile(process.argv[1]); if (errors.length > 0) throw errors[0];`,
			config,
		],
		{ encoding: "utf8" },
	);
	expect(run.stderr).toBe("");
	return patched(dir);
}

/** Edits a message, so the next start compiles. */
function editGreeting(dir: string): void {
	const catalog = join(dir, "messages", "de.json");
	writeFileSync(
		catalog,
		readFileSync(catalog, "utf8").replace("Hallo", "Guten Tag"),
	);
}

it(
	"takes up no build an older compiler saved once a chunk a compile runs changes, as built",
	processTest,
	async () => {
		const { dir, config } = project(catalogs);
		const copy = builtCopy(dir);
		await watched(copy, config, { saved: true });
		patchGenerator(copy);
		editGreeting(dir);

		expect(await watched(copy, config)).toMatch(/^grai: wrote/);
		// Every function, the unedited key's too, is the patched compiler's: none came from the save.
		const written = patched(dir);
		expect(written).toBeGreaterThan(0);
		expect(written).toBe(patchedFromNothing(copy, dir, config));
	},
);

it(
	"saves a build as the compiler that compiled it, though a chunk changes before the save, as built",
	processTest,
	async () => {
		const { dir, config } = project(catalogs);
		const copy = builtCopy(dir);
		// A dev server's first start serves its page from the compile, and writes and saves the build
		// once the process is quiet: the generator changes between the two.
		await served(copy, dir, config, () => patchGenerator(copy));
		editGreeting(dir);

		expect(await watched(copy, config)).toMatch(/^grai: wrote/);
		const written = patched(dir);
		expect(written).toBeGreaterThan(0);
		expect(written).toBe(patchedFromNothing(copy, dir, config));
	},
);

it(
	"reads an app's files again once a chunk of the code reader changes, and not for another of grai's, as built",
	processTest,
	() => {
		const { dir, config } = project({
			en: { title: "Title" },
			de: { title: "Titel" },
		});
		mkdirSync(join(dir, "src"), { recursive: true });
		writeFileSync(
			join(dir, "src", "a.ts"),
			'import { m } from "../out/messages.js";\nm.title();\n',
		);
		const copy = builtCopy(dir);
		const facts = join(dir, "out", ".grai", "facts");
		const checked = () => {
			spawnSync(
				process.execPath,
				[join(copy, "cli.js"), "check", "--config", config],
				{
					encoding: "utf8",
				},
			);
			return readFileSync(facts, "utf8");
		};
		const kept = checked();
		const reader = holding(copy, "function factsOf(");
		expect(listed(copy, "reader")).toContain(reader);
		expect(listed(copy, "reader")).not.toContain("vite.js");

		appendFileSync(join(copy, "vite.js"), "\n");
		expect(checked()).toBe(kept);
		appendFileSync(join(copy, reader), "\n");
		const read = checked();

		expect(read.split("\n")[0]).not.toBe(kept.split("\n")[0]);
	},
);
