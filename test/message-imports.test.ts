import { expect, it } from "vitest";
import { moduleOf } from "../src/message-imports.ts";

it("names the output's modules by their paths, and any other import other", () => {
	expect(
		[
			"./out/messages.js",
			"$lib/i18n/messages",
			"./out/keys.js",
			"#i18n/messages/cart_title.js",
			"./i18n/messages/title.ts",
			"lodash/keys.js",
			"./messages-panel.svelte",
			"@ui/messages/Banner.svelte",
			"./components/Header.svelte",
			"svelte",
		].map(moduleOf),
	).toEqual([
		{ type: "messages" },
		{ type: "messages" },
		{ type: "keys" },
		{ type: "key", key: "cart_title" },
		{ type: "key", key: "title" },
		{ type: "keys" },
		{ type: "other" },
		{ type: "other" },
		{ type: "other" },
		{ type: "other" },
	]);
});
