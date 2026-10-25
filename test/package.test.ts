import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
/** The package manager running the tests, as it names itself to scripts; else pnpm on the PATH. */
const pnpm = process.env.npm_execpath ?? "pnpm";

/** What `pnpm pack --json` prints. */
type Packed = { files: { path: string }[] };
/** The fields of package.json that name the package's files. */
type Manifest = {
	exports: Record<string, Record<string, string>>;
	bin: Record<string, string>;
};

let packed: string[] | undefined;

/** The files `pnpm pack` puts in the tarball, sorted. Its prepack builds the package first. */
function packedFiles(): string[] {
	if (packed !== undefined) return packed;
	const destination = mkdtempSync(join(tmpdir(), "grai-pack-"));
	try {
		const output: Packed = JSON.parse(
			execFileSync(
				pnpm,
				["pack", "--json", "--pack-destination", destination],
				{ cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
			),
		);
		packed = output.files.map((file) => file.path).sort();
		return packed;
	} finally {
		rmSync(destination, { recursive: true, force: true });
	}
}

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

function text(file: string): string {
	return readFileSync(join(root, file), "utf8");
}

it("packs each module compiled with its declarations, and nothing else", () => {
	expect(packedFiles()).toEqual(
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
	const shipped = packedFiles()
		.filter((file) => file.startsWith("dist/runtime/"))
		.map((file) => [file.slice("dist/".length), text(file)]);
	const written = runtimeModules().map((file) => [file, text(`src/${file}`)]);

	expect(shipped).toEqual(written);
});

it("packs every file the package's exports and bin name", () => {
	const manifest: Manifest = JSON.parse(text("package.json"));
	const targets = [
		...Object.values(manifest.exports).flatMap((conditions) =>
			Object.values(conditions),
		),
		...Object.values(manifest.bin),
	].map((target) => target.replace(/^\.\//, ""));
	const files = new Set(packedFiles());

	expect(targets.filter((target) => !files.has(target))).toEqual([]);
});
