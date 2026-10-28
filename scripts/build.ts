// The package's build: the TypeScript sources compiled into dist with their declarations, and the
// runtime's modules beside them as they are written, with the templates of the output's
// declarations. The compiler copies those into every project's output, so tsc, which would print
// them anew, never sees them. dist starts empty, so a
// module removed from src never ships. Last, the list of the compiler's modules as built, each
// with the hash of its bytes, which a start takes in place of parsing them while they are as built.
//
// usage: node scripts/build.ts
import { execFileSync } from "node:child_process";
import { cpSync, rmSync, writeFileSync } from "node:fs";
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

const { compilerModulesFile, digestOf } = await import(
	new URL("compiler-identity.js", dist).href
);
const { compilerModules } = await import(
	new URL("compiler-modules.js", dist).href
);
const modules: Map<string, Buffer> | undefined = await compilerModules();
if (modules === undefined)
	throw new Error(
		"The compiler's modules in dist were not all found: one imports a path no literal gives, or none of dist's files.",
	);
writeFileSync(
	new URL(compilerModulesFile, dist),
	`${JSON.stringify(
		Object.fromEntries(
			[...modules]
				.sort(([a], [b]) => (a < b ? -1 : 1))
				.map(([file, bytes]) => [file, digestOf(bytes)]),
		),
		null,
		"\t",
	)}\n`,
);
