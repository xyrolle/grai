import type { CompiledKey } from "./compilation.ts";
import type { Config } from "./config.ts";
import type { RenderedModules } from "./output-modules.ts";

/** What a dev server serves of a key: its code in each locale, and what that code calls. */
export type ServedKey = Pick<
	CompiledKey,
	"kind" | "variants" | "parts" | "uses" | "plurals" | "formats" | "globals"
>;

/**
 * What a dev server serves its modules from: the config, each key's code, the keys changed since
 * the build served before, and the output's modules beside the keys. A project compiled is one.
 */
export type Served = {
	config: Config;
	compilation: {
		keys: ReadonlyMap<string, ServedKey>;
		changed: ReadonlySet<string>;
	};
	rendered: Pick<RenderedModules, "modules" | "files">;
};
