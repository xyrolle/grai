// The declarations a compiled output carries, checked by TypeScript after a timed compile and never
// inside its clock: a probe that calls every key of the reference with its inputs, through the
// output's messages.js, must check clean with the declarations checked too, and a call of a key no
// catalog has must fail, so that the declarations type each key rather than let any call through.
// An output compiled without declarations must have none.
import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { takesInputs } from "./calls.mjs";

const tsc = new URL("node_modules/.bin/tsc", import.meta.url).pathname;

const compilerOptions = {
	strict: true,
	noEmit: true,
	module: "preserve",
	moduleResolution: "bundler",
	target: "es2023",
	lib: ["es2023", "dom"],
	types: [],
	skipLibCheck: false,
};

/** The probe: each call as an app writes it, and one of a key no catalog has, which must fail. */
function probe(messages, calls) {
	const call = (c) =>
		`m[${JSON.stringify(c.key)}](${takesInputs(c) ? JSON.stringify(c.inputs) : ""});`;
	return `import { m } from ${JSON.stringify(messages)};
${calls.map(call).join("\n")}
// @ts-expect-error: no catalog has this key.
m.no_catalog_has_this_key();
`;
}

/**
 * Throws unless TypeScript checks the probe of `calls` against the output in `outdir` clean. The
 * probe and its tsconfig are written into `directory`.
 */
export function checkDeclarations(directory, outdir, calls) {
	const messages = `./${relative(directory, join(outdir, "messages.js"))}`;
	writeFileSync(join(directory, "probe.ts"), probe(messages, calls));
	const config = join(directory, "tsconfig.probe.json");
	writeFileSync(
		config,
		JSON.stringify({ compilerOptions, files: ["probe.ts"] }),
	);
	try {
		execFileSync(tsc, ["-p", config], { encoding: "utf8" });
	} catch (error) {
		throw new Error(
			`TypeScript rejects ${outdir}'s declarations:\n${error.stdout.split("\n").slice(0, 20).join("\n")}`,
		);
	}
}

/** Throws if the output in `outdir` has any declaration file. */
export function checkNoDeclarations(outdir) {
	const declared = readdirSync(outdir, { recursive: true, encoding: "utf8" });
	const found = declared.find((file) => file.endsWith(".d.ts"));
	if (found !== undefined)
		throw new Error(
			`${outdir} has ${found}, though no declarations were asked for.`,
		);
}
