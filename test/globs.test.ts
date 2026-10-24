import { describe, expect, it } from "vitest";
import { globMatcher, isGlob } from "../src/globs.ts";

const conventionalTests = globMatcher([
	"**/*.{test,spec}.*",
	"**/{test,tests,__tests__}/**",
]);

describe("a glob", () => {
	it("matches test files by name and by folder, at any depth, and nothing else", () => {
		const matched = [
			"page.test.ts",
			"src/routes/page.svelte.test.ts",
			"src/lib/Cart.spec.tsx",
			"tests/helpers.ts",
			"src/lib/__tests__/deep/cart.ts",
		];
		const unmatched = [
			"src/latest.ts",
			"src/contest/page.ts",
			"src/test.ts",
			"src/routes/+page.svelte",
		];

		expect(matched.filter(conventionalTests)).toEqual(matched);
		expect(unmatched.filter(conventionalTests)).toEqual([]);
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
