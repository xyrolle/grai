import { basename, join } from "node:path";
import MagicString from "magic-string";
import { type AST, parse } from "svelte/compiler";
import type { Plugin, Rollup } from "vite";
import type { Build } from "./compile.ts";
import { GraiError } from "./error.ts";
import { textPrefix } from "./locale-chunks.ts";
import {
	type ImportedName,
	importedName,
	type Modules,
} from "./output-names.ts";
import {
	calledNames,
	componentImports,
	type OutputBinding,
	type TextCall,
	textCalls,
} from "./svelte-text-calls.ts";
import type { GraiPlugin } from "./vite-plugin.ts";

/** The plugin's name, and the one of vite-plugin-svelte's plugin it must run before. */
const name = "grai:svelte";
const svelteCompile = "vite-plugin-svelte:compile";

/**
 * The client build's text constants. Svelte reads an imported string as a plain value, where it
 * wraps each message call in a derived signal of its own and runs it as the page hydrates. So in
 * a client build, a component's call of a text key with no arguments becomes a read of that key's
 * string in the page's locale (`pageText` in the runtime). A page's words stay its locale's until
 * it reloads, which `switch: "reload"` promises; under `"live"` components are left as they are,
 * as is dev.
 *
 * The server build reads the same calls as a property, `.text`, whose getter calls the key in the
 * request's locale. Under `experimental.async`, Svelte takes a call made after a component's
 * `await` as writing what it touches, and every later read of the namespace as waiting on that
 * await: a call kept on the server would compile into blocks of its own, which the client's string
 * does not have, and the page would be drawn again rather than hydrated. A property read waits on
 * nothing, as the string does.
 */
export function svelteTexts(core: GraiPlugin): Plugin {
	let followed: { build: Build; names: ImportedName } | undefined;
	/** The follower of a build's names, which keeps each module it parses for the build. */
	const namesOf = (build: Build) => {
		if (followed?.build !== build) {
			const { keys } = build.compilation;
			const keysFile = join(build.config.outdir, "keys.js");
			followed = {
				build,
				names: importedName(keysFile, (key) => keys.has(key)),
			};
		}
		return followed.names;
	};
	return {
		name,
		apply: "build",
		configResolved({ plugins, configFile }) {
			const order = plugins.map((plugin) => plugin.name);
			const compile = order.indexOf(svelteCompile);
			if (compile !== -1 && compile < order.indexOf(name)) {
				throw new GraiError(
					"plugin-order",
					{ file: basename(configFile ?? "vite.config") },
					"list grai() from grai/svelte before sveltekit() or svelte(), so it reads each component before Svelte compiles it.",
				);
			}
		},
		transform: {
			filter: { id: /\.svelte$/ },
			async handler(code, id) {
				const build = core.build();
				if (build === undefined || build.config.switch === "live") return null;
				const read =
					this.environment.config.consumer === "server" ? ".text" : "";
				const ast = parsed(code, id);
				if (ast === undefined) return null;
				const bindings = await outputBindings(
					ast,
					id,
					namesOf(build),
					modulesOf(this),
				);
				const { keys } = build.compilation;
				const calls = textCalls(
					ast,
					bindings,
					(key) => keys.get(key)?.kind === "text",
				);
				if (calls === undefined || calls.length === 0) return null;
				const edits = withTexts(code, calls, read);
				return {
					code: edits.toString(),
					map: edits.generateMap({ source: id, hires: true }),
				};
			},
		},
	};
}

/**
 * The component's tree, or nothing for a component Svelte cannot parse: its compile, which comes
 * next, reports the error with its own frame.
 */
function parsed(code: string, id: string): AST.Root | undefined {
	try {
		return parse(code, { modern: true, filename: id });
	} catch {
		return undefined;
	}
}

/** The names a component imports from grai's output, of those it calls with no arguments. */
async function outputBindings(
	ast: AST.Root,
	id: string,
	names: ImportedName,
	modules: Modules,
): Promise<Map<string, OutputBinding>> {
	const called = calledNames(ast);
	const bindings = new Map<string, OutputBinding>();
	for (const imported of componentImports(ast)) {
		if (!called.has(imported.local)) continue;
		const name = await names(imported.source, id, imported.imported, modules);
		if (name !== undefined)
			bindings.set(imported.local, { name, scriptStart: imported.scriptStart });
	}
	return bindings;
}

/** The bundler's modules as the names are followed through them. */
function modulesOf(context: Rollup.TransformPluginContext): Modules {
	return {
		resolve: async (source, importer) =>
			(await context.resolve(source, importer))?.id,
		// A component is never followed: loading one from another's transform can wait on itself,
		// as a component that imports itself would.
		code: async (id) =>
			id.endsWith(".svelte")
				? undefined
				: ((await context.load({ id })).code ?? undefined),
	};
}

/**
 * The component with each call read from its key's text module, imported once per key and script:
 * the import itself, or `read` of it.
 */
function withTexts(
	code: string,
	calls: readonly TextCall[],
	read: string,
): MagicString {
	const edits = new MagicString(code);
	const imported = new Map<number, Set<string>>();
	for (const call of calls) {
		edits.overwrite(
			call.start,
			call.end,
			`${localName(code, call.key)}${read}`,
		);
		const keys = imported.get(call.scriptStart) ?? new Set();
		imported.set(call.scriptStart, keys.add(call.key));
	}
	for (const [start, keys] of imported) {
		const lines = [...keys].map(
			(key) =>
				`\nimport { ${key} as ${localName(code, key)} } from "${textPrefix}${key}";`,
		);
		edits.appendLeft(start, lines.join(""));
	}
	return edits;
}

/** The name a key's string takes in a component: one its source does not hold anywhere. */
function localName(code: string, key: string): string {
	let local = `grai_${key}`;
	while (code.includes(local)) local = `_${local}`;
	return local;
}
