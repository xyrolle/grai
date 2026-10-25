import { describe, expect, it } from "vitest";
import { readConfig } from "../src/config.ts";
import { globMatcher, isGlob } from "../src/globs.ts";
import { project } from "./project.ts";

describe("a glob", () => {
	it("matches, by default, test files by name, __tests__ folders and the root's test folders, and no shipped file", () => {
		const { config } = project({ en: { title: "Title" } });
		const isTest = globMatcher(readConfig(config).tests);
		const matched = [
			"page.test.ts",
			"src/routes/page.svelte.test.ts",
			"src/lib/Cart.spec.tsx",
			"src/lib/__tests__/deep/cart.ts",
			"test/setup.ts",
			"tests/helpers.ts",
		];
		const unmatched = [
			"src/latest.ts",
			"src/contest/page.ts",
			"src/test.ts",
			"src/routes/tests/+page.svelte",
			"src/lib/test/fixture-free.ts",
		];

		expect(matched.filter(isTest)).toEqual(matched);
		expect(unmatched.filter(isTest)).toEqual([]);
	});

	it("reads only *, **, ? and {a,b}, with each { closed before the next", () => {
		expect(["src/**/*.test.?s", "{a,b}/{c,d}"].every(isGlob)).toBe(true);
		expect(
			["", "src/[ab].ts", "!src/**", "+(a|b).ts", "{a,{b,c}}", "a}{"].some(
				isGlob,
			),
		).toBe(false);
	});
});
