import { execFile } from "node:child_process";
import { readdirSync } from "node:fs";
import { relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const tsc = fileURLToPath(new URL("../node_modules/.bin/tsc", import.meta.url));

/** The files a project of the repo's type-check reads from `src/runtime`, sorted. */
async function runtimeFilesRead(project: string): Promise<string[]> {
	const { stdout } = await promisify(execFile)(
		tsc,
		["-p", project, "--listFilesOnly"],
		{ cwd: root },
	);
	return stdout
		.split("\n")
		.map((file) => relative(root, file).replaceAll("\\", "/"))
		.filter((file) => file.startsWith("src/runtime/"))
		.sort();
}

function runtimeFiles(pattern: RegExp): string[] {
	return readdirSync(new URL("../src/runtime/", import.meta.url))
		.filter((file) => pattern.test(file))
		.map((file) => `src/runtime/${file}`)
		.sort();
}

it("keeps the output's declarations as templates, which type-checking the runtime never reads as its modules' types", async () => {
	expect(runtimeFiles(/\.d\.ts\.template$/)).toEqual([
		"src/runtime/runtime.d.ts.template",
		"src/runtime/server.d.ts.template",
		"src/runtime/set-locale.live.d.ts.template",
		"src/runtime/set-locale.reload.d.ts.template",
		"src/runtime/testing.d.ts.template",
	]);
	// The modules, checked as JavaScript, and the declarations of config.js, which only an output has.
	const read = [...runtimeFiles(/\.js$/), "src/runtime/config.d.ts"].sort();

	expect(await runtimeFilesRead("tsconfig.runtime.json")).toEqual(read);
});
