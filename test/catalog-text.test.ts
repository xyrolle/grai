import { describe, expect, it } from "vitest";
import type { KeyPath } from "../src/catalog-keys.ts";
import { layoutOf, tabbedLayout } from "../src/catalog-layout.ts";
import { withMessages, withoutKeys } from "../src/catalog-text.ts";

/** The text with the messages set at their paths, in the text's own layout. */
function set(
	text: string,
	messages: readonly (readonly [KeyPath, unknown])[],
): string {
	return withMessages(text, messages, layoutOf(text) ?? tabbedLayout);
}

describe("a catalog's text with messages set", () => {
	it("writes a new entry on the line of a catalog laid out on one line", () => {
		expect(
			set('{"a": "x", "b": "y"}\n', [[["c"], [{ match: { "n=*": "z" } }]]]),
		).toBe('{"a": "x", "b": "y", "c": [{"match":{"n=*":"z"}}]}\n');
	});

	it("sets the entry JSON reads when a catalog writes a key twice", () => {
		expect(set('{\n\t"a": "x",\n\t"a": "y"\n}', [[["a"], "z"]])).toBe(
			'{\n\t"a": "x",\n\t"a": "z"\n}',
		);
	});

	it("puts the entries of a catalog without any between its braces, in the layout given", () => {
		expect(withMessages("{}\n", [[["a"], { b: "x" }]], tabbedLayout)).toBe(
			'{\n\t"a": {\n\t\t"b": "x"\n\t}\n}\n',
		);
	});

	it("sets a message in the object its path names, in that object's layout, and makes one that is missing", () => {
		const text =
			'{\n  "cart": {\n    "title": "Cart"\n  },\n  "empty": {}\n}\n';

		expect(
			set(text, [
				[["cart", "total"], "Total"],
				[["empty", "note"], "Note"],
				[["account", "menu", "title"], "Account"],
			]),
		).toBe(
			'{\n  "cart": {\n    "title": "Cart",\n    "total": "Total"\n  },\n  "empty": {\n    "note": "Note"\n  },\n  "account": {\n    "menu": {\n      "title": "Account"\n    }\n  }\n}\n',
		);
	});

	it("puts a message whose path runs through a message beside it, under its whole key", () => {
		expect(set('{\n\t"cart": "Cart"\n}', [[["cart", "title"], "Title"]])).toBe(
			'{\n\t"cart": "Cart",\n\t"cart_title": "Title"\n}',
		);
	});
});

describe("a catalog's text without some keys", () => {
	it("removes each message with the separator before it, and an object the removal empties", () => {
		const text =
			'{\n\t"$schema": "s",\n\t"cart": {\n\t\t"title": "Cart",\n\t\t"total": "Total"\n\t},\n\t"menu": {\n\t\t"home": "Home"\n\t},\n\t"footer": "Footer"\n}\n';

		expect(withoutKeys(text, new Set(["cart_total", "menu_home"]))).toBe(
			'{\n\t"$schema": "s",\n\t"cart": {\n\t\t"title": "Cart"\n\t},\n\t"footer": "Footer"\n}\n',
		);
	});
});
