// One measurement of compile-time.mjs in a process of its own: `node compile-runs.mjs <json>`, which
// prints what it timed as JSON on its last line. Each clock starts once the library's modules have
// loaded.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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

	/**
	 * Paraglide's Vite plugin, driven as a dev server drives it: its config hooks, its `buildStart`,
	 * which compiles in the layout it takes in development, and after the edit is saved, its
	 * `watchChange`, which compiles again from the compilation it kept, writing only the files
	 * that changed, and then takes a digest of what it read.
	 */
	async "paraglide-plugin"(options) {
		await forDeclarations(options);
		const { paraglideVitePlugin } = await import("@inlang/paraglide-js");
		const plugin = paraglideVitePlugin(paraglideOptions(options));
		plugin.config.handler();
		plugin.configResolved.handler({ root: dirname(options.project) });
		// No bundler context: the plugin registers its watched files only where a bundler takes them.
		const cold = await timed(() => plugin.buildStart.call({}));
		const layout = join(
			options.outdir,
			"messages",
			`${options.edit.locale}.js`,
		);
		if (!existsSync(layout))
			throw new Error(
				`Paraglide's plugin did not write locale modules: no ${layout}.`,
			);
		save(options.edit);
		const edited = await timed(() => plugin.watchChange(options.edit.catalog));
		return { cold: cold.ms, edit: edited.ms };
	},
};

const options = JSON.parse(process.argv[2]);
console.log(JSON.stringify(await runs[options.run](options)));
