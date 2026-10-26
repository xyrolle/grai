import { afterEach, expect, it, vi } from "vitest";
import { moduleOf } from "../src/output-paths.ts";

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

afterEach(() => {
	vi.restoreAllMocks();
});

it("tells an import that names none of the output's modules by its words, without splitting its path", () => {
	const split = vi.spyOn(String.prototype, "split");
	const imports = [
		"./components/Header.svelte",
		"$lib/stores/cart.ts",
		"svelte/store",
		"@scope/ui/button.js",
	];

	const modules = imports.map(moduleOf);

	expect(modules.map((module) => module.type)).toEqual([
		"other",
		"other",
		"other",
		"other",
	]);
	expect(split).not.toHaveBeenCalled();
});
