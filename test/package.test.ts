import { execFileSync, spawnSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	type BuiltPart,
	builtModulesFile,
	digestOf,
} from "../src/compiler-identity.ts";
import { project } from "./project.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
/** The package manager running the tests, as it names itself to scripts; else pnpm on the PATH. */
const pnpm = process.env.npm_execpath ?? "pnpm";
/** What the build and `pnpm pack` read: the manifest, the files it ships, the sources and configs. */
const packageFiles = [
	"package.json",
	"README.md",
	"LICENSE",
	"CHANGELOG.md",
	"SECURITY.md",
	"config.schema.json",
	"tsconfig.json",
	"tsconfig.build.json",
	"src",
	"scripts",
];

/** What `pnpm pack --json` prints. */
type Packed = { files: { path: string }[] };
/** The fields of package.json that name the package's files. */
type Manifest = {
	exports: Record<string, Record<string, string>>;
	bin: Record<string, string>;
};

/**
 * The package packed from a copy of it, whose prepack builds into the copy's own dist: the repo's
 * dist is what other tests read meanwhile, such as the Next example's build. The copy's
 * directory, and the files `pnpm pack` put in the tarball, sorted. Both go in `dir`.
 */
function packCopy(dir: string): { dir: string; files: string[] } {
	const copy = join(dir, "package");
	for (const file of packageFiles) {
		cpSync(join(root, file), join(copy, file), { recursive: true });
	}
	// A junction, as Windows links a directory without an administrator only so.
	symlinkSync(
		join(root, "node_modules"),
		join(copy, "node_modules"),
		"junction",
	);
	const destination = join(dir, "tarball");
	mkdirSync(destination);
	const output: Packed = JSON.parse(
		execFileSync(pnpm, ["pack", "--json", "--pack-destination", destination], {
			cwd: copy,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		}),
	);
	return { dir: copy, files: output.files.map((file) => file.path).sort() };
}

/** The temporary directory the copy and its tarball are in, removed after the tests. */
let temp: string | undefined;
let packed: { dir: string; files: string[] } = { dir: "", files: [] };
// Packing builds the package, which a loaded machine can take well over a test's five seconds for.
beforeAll(() => {
	temp = realpathSync(mkdtempSync(join(tmpdir(), "grai-package-")));
	packed = packCopy(temp);
}, 120_000);
afterAll(() => {
	if (temp !== undefined) rmSync(temp, { recursive: true, force: true });
});

/**
 * Each TypeScript module but the runtime's, by its path without `.ts`. A declaration file is no
 * module, and compiles to nothing.
 */
function sourceModules(): string[] {
	return readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" })
		.map((file) => file.replaceAll("\\", "/"))
		.filter(
			(file) =>
				file.endsWith(".ts") &&
				!file.endsWith(".d.ts") &&
				!file.startsWith("runtime/"),
		)
		.map((file) => file.replace(/\.ts$/, ""));
}

/**
 * The runtime's modules and the templates of the output's declarations, sorted: the compiler
 * copies the modules into every output as they are written, and the declarations from the
 * templates.
 */
function runtimeFiles(): string[] {
	return readdirSync(join(root, "src", "runtime"))
		.filter((file) => file.endsWith(".js") || file.endsWith(".d.ts.template"))
		.map((file) => `runtime/${file}`)
		.sort();
}

function text(dir: string, file: string): string {
	return readFileSync(join(dir, file), "utf8");
}

/** The packed bundle's files with an extension: dist's, but the runtime's, by its path in dist. */
function bundled(extension = ".js"): string[] {
	return packed.files
		.filter(
			(file) =>
				file.startsWith("dist/") &&
				file.endsWith(extension) &&
				!file.startsWith("dist/runtime/"),
		)
		.map((file) => file.slice("dist/".length));
}

/** The benches' entry (`src/bench.ts`), which the build makes and the package does not ship. */
const benchEntry = "bench";

it("packs the bundle with its maps, each module's declarations, the lists of the chunks grai's parts run, and nothing else", () => {
	expect(packed.files).toEqual(
		[
			"CHANGELOG.md",
			"LICENSE",
			"README.md",
			"SECURITY.md",
			"config.schema.json",
			"package.json",
			`dist/${builtModulesFile}`,
			...sourceModules()
				.filter((module) => module !== benchEntry)
				.map((module) => `dist/${module}.d.ts`),
			...bundled().map((file) => `dist/${file}`),
			...bundled(".js.map").map((file) => `dist/${file}`),
			...runtimeFiles().map((file) => `dist/${file}`),
		].sort(),
	);
	expect(bundled()).not.toContain(`${benchEntry}.js`);
});

it("maps each module of the bundle that holds code to its sources, which its map holds", () => {
	for (const file of bundled()) {
		const code = text(packed.dir, `dist/${file}`);
		const mapping = code.match(/\n\/\/# sourceMappingURL=(\S+)\n?$/)?.[1];
		if (mapping === undefined) {
			// A module of re-exports alone, whose every line is an import or an export.
			expect(
				code
					.split("\n")
					.filter((line) => line !== "" && !/^(import|export) /.test(line)),
				file,
			).toEqual([]);
			continue;
		}
		const map: { sources: string[]; sourcesContent: string[] } = JSON.parse(
			text(packed.dir, join("dist", dirname(file), mapping)),
		);
		expect(map.sourcesContent, file).toHaveLength(map.sources.length);
		for (const [index, source] of map.sources.entries())
			expect(map.sourcesContent[index], `${file}: ${source}`).toBe(
				text(packed.dir, join("dist", dirname(file), source)),
			);
	}
});

it("bundles each entry at its source's path, and the modules they share in chunks at dist's root", () => {
	const modules = new Set(sourceModules());
	const misplaced = bundled().filter(
		(file) =>
			!modules.has(file.replace(/\.js$/, "")) &&
			!/^[\w-]+-[\w-]{8}\.js$/.test(file),
	);

	expect(misplaced).toEqual([]);
	expect(bundled()).toContain("vite.js");
	expect(bundled()).toContain("next/watch-worker.js");
	expect(bundled()).toContain("nuxt/runtime/plugin.js");
});

it("packs the runtime's modules and the declarations' templates as they are written", () => {
	const shipped = packed.files
		.filter((file) => file.startsWith("dist/runtime/"))
		.map((file) => [file.slice("dist/".length), text(packed.dir, file)]);
	const written = runtimeFiles().map((file) => [
		file,
		text(root, `src/${file}`),
	]);

	expect(shipped).toEqual(written);
});

it("lists the chunks the compiler and the code reader run, each with the hash of its bytes as packed", () => {
	const lists: Record<BuiltPart, Record<string, string>> = JSON.parse(
		text(packed.dir, `dist/${builtModulesFile}`),
	);
	for (const listed of Object.values(lists)) {
		const packedDigests = Object.keys(listed).map((chunk) => [
			chunk,
			digestOf(readFileSync(join(packed.dir, "dist", chunk))),
		]);

		expect(Object.entries(listed)).toEqual(packedDigests);
	}
	// The module that finds grai's files is the compiler's: a list is of the directory it is in.
	expect(
		Object.keys(lists.compiler).filter((chunk) =>
			chunk.startsWith("package-files-"),
		),
	).toHaveLength(1);
	expect(Object.keys(lists.compiler)).not.toContain("cli.js");
	expect(Object.keys(lists.reader).length).toBeGreaterThan(0);
});

it("packs every file the package's exports and bin name", () => {
	const manifest: Manifest = JSON.parse(text(root, "package.json"));
	const targets = [
		...Object.values(manifest.exports)
			.flatMap((conditions) => Object.values(conditions))
			.map((target) => target.replace(/^\.\//, "")),
		// As npm writes a bin's path: it corrects one written with "./" as it publishes, with a warning.
		...Object.values(manifest.bin),
	];
	const files = new Set(packed.files);

	expect(targets.filter((target) => !files.has(target))).toEqual([]);
});

/**
 * The inline scripts of a page built by the Vite plugin of a module of grai's, `vite.ts` in the
 * sources or `vite.js` in a build, with the config: its locale script, which takes the runtime's
 * page functions as the module loaded them, and the copies' too.
 */
async function inlineScripts(
	vite: string,
	config: Record<string, unknown>,
): Promise<string[]> {
	const { dir } = project(
		{ en: { title: "Title" }, ro: { title: "Titlu" } },
		config,
	);
	writeFileSync(
		join(dir, "index.html"),
		`<!doctype html><html><head><script type="module" src="/main.js"></script></head><body></body></html>`,
	);
	writeFileSync(
		join(dir, "main.js"),
		`import { m } from "./out/messages.js";\ndocument.body.textContent = m.title();\n`,
	);
	const { grai } = await import(vite);
	await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins: [grai({ localeChunks: true })],
		build: { outDir: join(dir, "dist") },
	});
	const html = readFileSync(join(dir, "dist", "index.html"), "utf8");
	return [
		...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
	].map(([, code]) => code ?? "");
}

it("writes a page's locale script from the packed package as from the sources", async () => {
	const packedVite = pathToFileURL(join(packed.dir, "dist", "vite.js")).href;
	const sourceVite = new URL("../src/vite.ts", import.meta.url).href;
	// The default strategy, and one that matches a language, whose script holds the server's code.
	for (const config of [
		{},
		{ strategy: ["cookie", "preferredLanguage"], cookieName: "locale" },
	]) {
		const fromPacked = await inlineScripts(packedVite, config);

		expect(fromPacked.join("")).toContain("document.documentElement");
		expect(fromPacked).toEqual(await inlineScripts(sourceVite, config));
	}
}, 60_000);

it("names a source's file and line in a stack trace through the packed package, under --enable-source-maps", () => {
	const directory = temp ?? "";
	const installed = join(directory, "installed");
	mkdirSync(installed);
	const [tarball = ""] = readdirSync(join(directory, "tarball"));
	execFileSync("tar", [
		"-xzf",
		join(directory, "tarball", tarball),
		"-C",
		installed,
	]);
	const entry = pathToFileURL(join(installed, "package", "dist", "index.js"));
	// A config that is not there: the compile's error comes from the config's reader.
	const run = spawnSync(
		process.execPath,
		[
			"--enable-source-maps",
			"--input-type=module",
			"-e",
			`const { compile } = await import(${JSON.stringify(entry.href)}); const { errors } = await compile(process.argv[1]); console.log(errors[0].stack);`,
			join(installed, "missing", "grai.config.json"),
		],
		{ encoding: "utf8" },
	);
	const frame = /at readConfig \(.+[/\\]src[/\\]config\.ts:(\d+):(\d+)\)/.exec(
		run.stdout,
	);

	expect(frame, run.stdout + run.stderr).not.toBeNull();
	const [, line = "", column = ""] = frame ?? [];
	expect(
		text(root, "src/config.ts")
			.split("\n")
			[Number(line) - 1]?.slice(Number(column) - 1),
	).toMatch(/^readText\(/);
});
