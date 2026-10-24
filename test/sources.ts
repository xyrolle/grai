import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Writes source files into a project, by path relative to its root. */
export function writeSources(dir: string, files: Record<string, string>): void {
	for (const [path, text] of Object.entries(files)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
}

/** Reads a project's file, by path relative to its root. */
export function readText(dir: string, path: string): string {
	return readFileSync(join(dir, path), "utf8");
}

/** A Svelte component that reads one key on the namespace and imports another by its own path. */
export const cartSvelte = `<script lang="ts">
	import { m } from "$lib/i18n";
	import { cart_total } from "#i18n/messages/cart_total.js";
	let { count } = $props();
</script>

<h1>{m.cart_title()}</h1>
<p title={m["cart_title"]()}>{cart_total({ count })}</p>
<Price label={cart_total} />
`;

/** A TSX component that reads a key on the namespace, once optionally. */
export const headerTsx = `import { m } from "../out/messages.js";

export function Header() {
	return <h1 aria-label={m.cart_title()}>{m?.cart_title()}</h1>;
}
`;

/** The module that re-exports the namespace for the app. */
export const i18nTs = `import { m } from "../../out/messages.js";

export { m };
`;

/**
 * A catalog's text laid out as no formatter would: two spaces, Windows line breaks, and each entry
 * as given. A command leaves every entry it does not change exactly as it is written here.
 */
export function handLaid(...entries: string[]): string {
	return `{\r\n  ${entries.join(",\r\n  ")}\r\n}\r\n`;
}

/** The `$schema` entry a catalog starts with, for `handLaid`. */
export const schemaEntry =
	'"$schema": "https://inlang.com/schema/inlang-message-format"';
