import { describe, expect, it } from "vitest";
import { pseudoPattern } from "../src/pseudo-text.ts";

describe("a pseudo-locale", () => {
	it("accents each letter, grows the text by whole words, and brackets it, keeping its codes", () => {
		expect(pseudoPattern("Read the {#link}terms{/link}, {name} \\{x\\}")).toBe(
			"[Ŕéåð ţĥé {#link}ţéŕɱš{/link}, {name} \\{ẋ\\} one two]",
		);
		expect(pseudoPattern("OK")).toBe("[ÖĶ one]");
	});
});
