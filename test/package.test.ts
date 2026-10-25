import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
/** The package manager running the tests, as it names itself to scripts; else pnpm on the PATH. */
const pnpm = process.env.npm_execpath ?? "pnpm";
/** What the build and `pnpm pack` read: the manifest, the docs it ships, the sources and configs. */
const packageFiles = [
	"package.json",
	"README.md",
	"LICENSE",
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
 * Each TypeScript module but the runtime's, as dist holds it: compiled, with its declarations. A
 * declaration file is no module, and compiles to nothing.
 */
function compiledModules(): string[] {
	return readdirSync(join(root, "src"), { recursive: true, encoding: "utf8" })
		.map((file) => file.replaceAll("\\", "/"))
		.filter(
			(file) =>
				file.endsWith(".ts") &&
				!file.endsWith(".d.ts") &&
				!file.startsWith("runtime/"),
		)
		.flatMap((file) => {
			const module = `dist/${file.replace(/\.ts$/, "")}`;
			return [`${module}.d.ts`, `${module}.js`];
		});
}

/** The runtime's modules, sorted: the compiler copies them into every output as they are written. */
function runtimeModules(): string[] {
	return readdirSync(join(root, "src", "runtime"))
		.filter((file) => file.endsWith(".js"))
		.map((file) => `runtime/${file}`)
		.sort();
}

function text(dir: string, file: string): string {
	return readFileSync(join(dir, file), "utf8");
}

it("packs each module compiled with its declarations, and nothing else", () => {
	expect(packed.files).toEqual(
		[
			"LICENSE",
			"README.md",
			"package.json",
			...compiledModules(),
			...runtimeModules().map((file) => `dist/${file}`),
		].sort(),
	);
});

it("packs the runtime's modules as they are written", () => {
	const shipped = packed.files
		.filter((file) => file.startsWith("dist/runtime/"))
		.map((file) => [file.slice("dist/".length), text(packed.dir, file)]);
	const written = runtimeModules().map((file) => [
		file,
		text(root, `src/${file}`),
	]);

	expect(shipped).toEqual(written);
});

it("packs every file the package's exports and bin name", () => {
	const manifest: Manifest = JSON.parse(text(root, "package.json"));
	const targets = [
		...Object.values(manifest.exports).flatMap((conditions) =>
			Object.values(conditions),
		),
		...Object.values(manifest.bin),
	].map((target) => target.replace(/^\.\//, ""));
	const files = new Set(packed.files);

	expect(targets.filter((target) => !files.has(target))).toEqual([]);
});
