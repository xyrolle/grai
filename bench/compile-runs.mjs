// One measurement of compile-time.mjs in a process of its own: `node compile-runs.mjs <json>`, which
// prints what it timed as JSON on its last line. Each clock starts once the library's modules have
// loaded.
import { readFileSync, writeFileSync } from "node:fs";
import { graiEntry, graiModule } from "./grai.mjs";

/** The work's time in ms, and what it returned. */
async function timed(work) {
	const start = performance.now();
	const result = await work();
	return { ms: performance.now() - start, result };
}

/** Saves the edit into its catalog, as an editor saves it, outside every clock. */
function save({ catalog, key, text }) {
	const parsed = JSON.parse(readFileSync(catalog, "utf8"));
	parsed[key] = text;
	writeFileSync(catalog, JSON.stringify(parsed, null, "\t"));
}

function assertCompiled({ errors }) {
	if (errors.length > 0) throw errors[0];
}

/** Paraglide's options: the app's own (its strategy), and none of the extra files it can write. */
const paraglideOptions = ({
	project,
	outdir,
	declarations,
	compilerOptions,
}) => ({
	project,
	outdir,
	emitTsDeclarations: declarations,
	...compilerOptions,
	emitGitIgnore: false,
	emitPrettierIgnore: false,
	emitReadme: false,
});

/** Loads TypeScript 6 for Paraglide's declarations, before Paraglide imports any TypeScript. */
async function forDeclarations({ declarations }) {
	if (!declarations) return;
	const { resolveTypeScript6 } = await import("./paraglide.mjs");
	resolveTypeScript6();
}

const runs = {
	/**
	 * grai: a full compile; the same compile again, which must write nothing; then one message
	 * edited, compiled again by `recompile` from the build of a compile before it, as its Vite
	 * plugin and `grai watch` compile an edit.
	 */
	async grai({ config, edit }) {
		const { compile } = await import(graiEntry("."));
		const { recompile } = await import(graiModule("compile.ts"));
		const cold = await timed(() => compile(config));
		assertCompiled(cold.result);
		const noop = await timed(() => compile(config));
		assertCompiled(noop.result);
		if (noop.result.written.length > 0)
			throw new Error("grai's compile with nothing changed wrote files.");
		const { build } = await recompile(config, undefined);
		save(edit);
		const edited = await timed(() => recompile(config, build));
		assertCompiled(edited.result.result);
		return { cold: cold.ms, noop: noop.ms, edit: edited.ms };
	},

	/** Paraglide's compiler: a full compile in the layout given. */
	async "paraglide-compiler"(options) {
		await forDeclarations(options);
		const { compile } = await import("@inlang/paraglide-js");
		const cold = await timed(() =>
			compile({
				...paraglideOptions(options),
				outputStructure: options.outputStructure,
			}),
		);
		return { cold: cold.ms };
	},
};

const options = JSON.parse(process.argv[2]);
console.log(JSON.stringify(await runs[options.run](options)));
