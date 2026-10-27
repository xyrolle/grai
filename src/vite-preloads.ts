import type { ModulePreloadOptions } from "vite";
import { isMessageChunk } from "./message-directories.ts";

/**
 * The client build's module preloads, without a page's own preloads of message chunks: those
 * hold every locale's words, and the page's locale script preloads its locale's copies instead. A
 * dynamic import's preloads keep them, as Vite resolves those through the page's import map. An
 * app's own `resolveDependencies` still decides first.
 */
export function pagePreloads(
	modulePreload: boolean | ModulePreloadOptions | undefined,
): ModulePreloadOptions | undefined {
	if (modulePreload === false) return undefined;
	const resolve =
		typeof modulePreload === "object"
			? modulePreload.resolveDependencies
			: undefined;
	return {
		resolveDependencies(file, dependencies, context) {
			const resolved = resolve?.(file, dependencies, context) ?? dependencies;
			return context.hostType === "html"
				? resolved.filter((dependency) => !isMessageChunk(dependency))
				: resolved;
		},
	};
}
