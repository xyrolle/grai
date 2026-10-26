import { expect, it } from "vitest";
import { messageBindings, moduleOf } from "../src/message-imports.ts";

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

it("lists a destructured dynamic import once, as the one import it is", () => {
	const text = `const { cart_title } = await import("#i18n/messages/cart_title.js");\nconst late = import("#i18n/messages/cart_total.js");\n`;

	expect(
		messageBindings(text, new Set(["m"])).statements.map(
			({ binds, specifier }) => ({ binds, specifier: specifier.text }),
		),
	).toEqual([
		{ binds: true, specifier: "#i18n/messages/cart_title.js" },
		{ binds: false, specifier: "#i18n/messages/cart_total.js" },
	]);
});
