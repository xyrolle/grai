import type { CompiledKey } from "./compilation.ts";
import type { Build } from "./compile.ts";
import type { Config } from "./config.ts";
import type { RenderedModules } from "./output-modules.ts";

/** What a dev server serves of a key: its code in each locale, and what that code calls. */
export type ServedKey = Pick<
	CompiledKey,
	"kind" | "variants" | "parts" | "uses" | "plurals" | "formats" | "globals"
>;

/**
 * What a dev server serves its modules from: the config, each key's code, the keys changed since
 * the build served before, and the output's modules beside the keys. A project compiled is one, and
 * so is a saved build's index (`servedIndex`).
 */
export type Served = {
	config: Config;
	compilation: {
		keys: ReadonlyMap<string, ServedKey>;
		changed: ReadonlySet<string>;
	};
	rendered: Pick<RenderedModules, "modules" | "files">;
};

/**
 * A build's index, which its save carries ahead of the build: what a dev server serves, with the
 * hashes of the catalogs it was compiled from, so that a restart can serve its first page from the
 * index alone, about a tenth of the build, while the catalogs are as they were, and take up the
 * build after. No key changed since, and of the output only the modules beside the keys, which the
 * keys import.
 */
export type ServedIndex = Served & { hashes: readonly string[] };

/** A build's index (`ServedIndex`). */
export function servedIndex(build: Build): ServedIndex {
	const keys = new Map<string, ServedKey>();
	for (const [key, compiled] of build.compilation.keys) {
		const { kind, variants, parts, uses, plurals, formats, globals } = compiled;
		keys.set(key, { kind, variants, parts, uses, plurals, formats, globals });
	}
	const { moduleFiles, modules } = build.rendered;
	return {
		config: build.config,
		compilation: { keys, changed: new Set() },
		rendered: {
			modules,
			files: new Map(
				[...moduleFiles.immutable, ...moduleFiles.mutable].map(
					([path, text]) => [path, text],
				),
			),
		},
		hashes: build.hashes,
	};
}
