// The package as published, on the oldest Node its `engines` accepts, which CI runs this on: its
// tarball, installed with npm into a copy of `project/` beside the Vite the repository tests with,
// compiles the catalogs with `grai compile`, has Node load a key's path as that key's module alone
// through `--import @xyrolle/grai/register`, and builds the page with Vite.
//
// usage: node test/oldest-node/run.mjs <tarball>
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [tarball] = process.argv.slice(2);
if (tarball === undefined) throw new Error("usage: node run.mjs <tarball>");
const { version: vite } = JSON.parse(
	readFileSync(
		new URL("../../node_modules/vite/package.json", import.meta.url),
		"utf8",
	),
);
const dir = mkdtempSync(join(tmpdir(), "grai-oldest-node-"));
cpSync(fileURLToPath(new URL("project/", import.meta.url)), dir, {
	recursive: true,
});
/** Runs a command in the project, its output printed, and gives what it wrote to stdout. */
const run = (command, args) =>
	execFileSync(command, args, {
		cwd: dir,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "inherit"],
	});

try {
	run("npm", [
		"install",
		"--no-audit",
		"--no-fund",
		resolve(tarball),
		`vite@${vite}`,
	]);
	run("npx", ["grai", "compile"]);
	assert.deepEqual(
		JSON.parse(
			run(process.execPath, ["--import", "@xyrolle/grai/register", "app.js"]),
		),
		{ exports: ["title"], title: "Your cart", items: "2 items" },
	);
	run("npx", ["vite", "build"]);
	const built = join(dir, "dist");
	assert.ok(
		readdirSync(built, { recursive: true, encoding: "utf8" }).some(
			(file) =>
				file.endsWith(".js") &&
				readFileSync(join(built, file), "utf8").includes("Your cart"),
		),
		"the built page has its messages",
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
console.log(
	`@xyrolle/grai on Node ${process.versions.node}: compiled, its hooks registered, and built with Vite ${vite}.`,
);
