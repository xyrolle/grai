// The package's build: the TypeScript sources compiled into dist with their declarations, and the
// runtime's modules beside them as they are written. The compiler copies those into every
// project's output, so tsc, which would print them anew, never sees them. dist starts empty, so a
// module removed from src never ships.
//
// usage: node scripts/build.ts
import { execFileSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dist = new URL("../dist/", import.meta.url);
const tsc = new URL("../node_modules/typescript/bin/tsc", import.meta.url);
const project = new URL("../tsconfig.build.json", import.meta.url);

rmSync(dist, { recursive: true, force: true });
execFileSync(
	process.execPath,
	[fileURLToPath(tsc), "-p", fileURLToPath(project)],
	{ stdio: "inherit" },
);
cpSync(new URL("../src/runtime/", import.meta.url), new URL("runtime/", dist), {
	recursive: true,
	filter: (source) => !source.endsWith(".d.ts"),
});
