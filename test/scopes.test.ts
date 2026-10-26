import { expect, it } from "vitest";
import { parse } from "../src/code/parse.ts";
import { Scopes } from "../src/code/scopes.ts";

/** What each `m` at the marked places reads: the line of its declaration, or "global". */
function readsOf(text: string): string[] {
	const { program } = parse("module.ts", text);
	const scopes = new Scopes(program);
	const lineOf = (at: number) => text.slice(0, at).split("\n").length;
	return [...text.matchAll(/\bm\.read\b/g)].map(({ index }) => {
		const binding = scopes.resolve("m", index);
		return binding === undefined
			? "global"
			: `line ${lineOf(binding.node.start)}`;
	});
}

it("reads each name from its nearest declaration, by ECMAScript's scopes", () => {
	const text = [
		'import { m } from "./out/messages.js";',
		"m.read;",
		"function f(m) { return m.read; }",
		"try { m.read; } catch (m) { m.read; }",
		"{ let m = 1; m.read; } m.read;",
		"class C { static { var m = 2; if (m) { m.read; } } }",
		"const g = class m { h() { return m.read; } };",
		"for (const m of []) m.read;",
	].join("\n");

	expect(readsOf(text)).toEqual([
		"line 1",
		"line 3",
		"line 1",
		"line 4",
		"line 5",
		"line 1",
		"line 6",
		"line 7",
		"line 8",
	]);
});

it("takes TypeScript's enums, namespaces and import-equals for values, and its types for none", () => {
	const text = [
		'import { m } from "./out/messages.js";',
		"function a() { enum m { read } return m.read; }",
		"function b() { namespace m { export const read = 1; } return m.read; }",
		'function c() { import m = require("./other.js"); return m.read; }',
		"function d() { type m = { read: 1 }; interface m { read: 1 } return m.read; }",
	].join("\n");

	expect(readsOf(text)).toEqual(["line 2", "line 3", "line 4", "line 1"]);
});

it("tells a use in a type, which reads nothing when the code runs, from a use of the value", () => {
	const text = [
		'import { m } from "./out/messages.js";',
		"type Title = ReturnType<typeof m.title>;",
		"function f(title: typeof m.title): string { return m.title(); }",
		"const x = m as unknown as typeof m;",
	].join("\n");
	const { program } = parse("module.ts", text);
	const scopes = new Scopes(program);
	const binding = scopes.resolve("m", 0);

	expect(
		binding === undefined
			? []
			: scopes
					.usesOf(binding)
					.map((use) => [
						text.slice(0, use.start).split("\n").length,
						scopes.isTypeUse(use),
					]),
	).toEqual([
		[2, true],
		[3, true],
		[3, false],
		[4, false],
		[4, true],
	]);
});
