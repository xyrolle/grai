import { describe, expect, it } from "vitest";
import { layoutOf, tabbedLayout, withMessages } from "../src/catalog-text.ts";

/** The text with the messages set, in the text's own layout. */
function set(text: string, messages: Record<string, unknown>): string {
	return withMessages(
		text,
		Object.entries(messages),
		layoutOf(text) ?? tabbedLayout,
	);
}

describe("a catalog's text with messages set", () => {
	it("writes a new entry on the line of a catalog laid out on one line", () => {
		expect(
			set('{"a": "x", "b": "y"}\n', { c: [{ match: { "n=*": "z" } }] }),
		).toBe('{"a": "x", "b": "y", "c": [{"match":{"n=*":"z"}}]}\n');
	});

	it("sets the entry JSON reads when a catalog writes a key twice", () => {
		expect(set('{\n\t"a": "x",\n\t"a": "y"\n}', { a: "z" })).toBe(
			'{\n\t"a": "x",\n\t"a": "z"\n}',
		);
	});

	it("puts the entries of a catalog without any between its braces, in the layout given", () => {
		expect(withMessages("{}\n", [["a", { b: "x" }]], tabbedLayout)).toBe(
			'{\n\t"a": {\n\t\t"b": "x"\n\t}\n}\n',
		);
	});
});
