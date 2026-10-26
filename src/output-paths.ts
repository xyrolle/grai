/**
 * Which of grai's output modules an import path names, by the path alone: `messages.js`, `keys.js`,
 * or a key's own path, `…/messages/<key>.js`, which an app maps to keys.js and a build resolves to
 * that key's module alone (`\0grai:key/<key>`). A command resolves a key's path to that module too,
 * so it follows the path as the build does.
 */

/** A module of the output, by its import path: `messages.js` (`m`), `keys.js`, one key's path, or another. */
export type MessageModule =
	| { type: "messages" | "keys" | "other" }
	| { type: "key"; key: string };

/** A key's name, as a key's path ends in it. */
const keyName = /^[A-Za-z_$][\w$]*$/;
const otherModule: MessageModule = { type: "other" };

/** The module an import path names, by its last segment without the extension. */
export function moduleOf(specifier: string): MessageModule {
	// Each of the output's modules has "messages" or "keys" in its path, and most imports have
	// neither: a dev server's import hook reads every import of the app, and spares splitting those.
	if (!specifier.includes("messages") && !specifier.includes("keys"))
		return otherModule;
	const segments = specifier.split("/");
	const last = (segments.at(-1) ?? "").replace(/\.[cm]?[jt]s$/, "");
	if (segments.at(-2) === "messages" && keyName.test(last)) {
		return { type: "key", key: last };
	}
	if (last === "messages" || last === "keys") return { type: last };
	return otherModule;
}
