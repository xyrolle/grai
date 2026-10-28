import { basename } from "node:path";
import MagicString from "magic-string";
import type { Plugin } from "vite";
import type { Span } from "./code/facts.ts";
import type { Reading } from "./code/reads.ts";
import { GraiError } from "./error.ts";
import { textPrefix } from "./locale-chunks.ts";
import type { GraiPlugin } from "./vite-plugin.ts";

/** A call of a text key with no arguments, where the component makes it, and its key. */
type TextCall = Span & { key: string };

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
 * The server build reads the same calls as a property, `.text`, whose getter reads the key's text
 * in the request's locale (`requestText` in the runtime). Under `experimental.async`, Svelte takes a call made after a component's
 * `await` as writing what it touches, and every later read of the namespace as waiting on that
 * await: a call kept on the server would compile into blocks of its own, which the client's string
 * does not have, and the page would be drawn again rather than hydrated. A property read waits on
 * nothing, as the string does.
 */
export function svelteTexts(core: GraiPlugin): Plugin {
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
					"list grai() from @xyrolle/grai/svelte before sveltekit() or svelte(), so it reads each component before Svelte compiles it.",
				);
			}
		},
		transform: {
			filter: { id: /\.svelte$/ },
			async handler(code, id) {
				const build = core.build();
				const reading = core.reading(this.environment.name);
				if (build === undefined || reading === undefined) return null;
				if (build.config.switch === "live") return null;
				const read = await reading.reading(id, code);
				const { keys } = build.compilation;
				const calls = textCalls(read, (key) => keys.get(key)?.kind === "text");
				const at = importsAt(read);
				if (calls.length === 0 || at === undefined) return null;
				const property =
					this.environment.config.consumer === "server" ? ".text" : "";
				const edits = withTexts(code, calls, at, property);
				return {
					code: edits.toString(),
					map: edits.generateMap({ source: id, hires: true }),
				};
			},
		},
	};
}

/**
 * Every call of a text key with no arguments the component makes: `m.key()`, and a call of a name
 * an import of the key binds, read by the component's scopes, so a name declared again is no call
 * of the key.
 */
function textCalls(
	reading: Reading,
	isText: (key: string) => boolean,
): TextCall[] {
	const calls = new Map<number, TextCall>();
	for (const { key, call, binding } of reading.reads) {
		if (!isText(key)) continue;
		if (call !== undefined) calls.set(call.start, { ...call, key });
		for (const reference of binding?.references ?? []) {
			if (reference.call !== undefined)
				calls.set(reference.call.start, { ...reference.call, key });
		}
	}
	return [...calls.values()];
}

/** Where the component's first script starts, which an import of its own may go at. */
function importsAt({ reads }: Reading): number | undefined {
	const facts = reads[0]?.source.facts;
	return facts === undefined || "error" in facts
		? undefined
		: facts.modules[0]?.importsAt;
}

/**
 * The component with each call read from its key's text module, imported once per key at the start
 * of its first script: the import itself, or `property` of it.
 */
function withTexts(
	code: string,
	calls: readonly TextCall[],
	importsAt: number,
	property: string,
): MagicString {
	const edits = new MagicString(code);
	const keys = new Set<string>();
	for (const call of calls) {
		edits.overwrite(
			call.start,
			call.end,
			`${localName(code, call.key)}${property}`,
		);
		keys.add(call.key);
	}
	const lines = [...keys].map(
		(key) =>
			`\nimport { ${key} as ${localName(code, key)} } from "${textPrefix}${key}";`,
	);
	edits.appendLeft(importsAt, lines.join(""));
	return edits;
}

/** The name a key's string takes in a component: one its source does not hold anywhere. */
function localName(code: string, key: string): string {
	let local = `grai_${key}`;
	while (code.includes(local)) local = `_${local}`;
	return local;
}
