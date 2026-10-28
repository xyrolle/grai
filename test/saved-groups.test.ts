import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { withoutContentHash } from "../src/content-names.ts";
import { readManifest } from "../src/manifest.ts";
import { saveGroups } from "../src/saved-groups.ts";
import { type Messages, project } from "./project.ts";

/** A catalog of `count` keys, each its key's words in the locale. */
const catalogOf = (locale: string, count: number) =>
	Object.fromEntries(
		Array.from({ length: count }, (_, index) => [
			`key${index}`,
			`${locale} key${index}`,
		]),
	);

/** The modules keys.js re-exports, by their paths in the output. */
const modulesOf = (out: string) =>
	readFileSync(join(out, "keys.js"), "utf8")
		.split("\n")
		.filter(Boolean)
		.map((line) => /"\.\/(keys\/[^"]+)"/.exec(line)?.[1] ?? "");

/** The modules keys.js re-exports, each by its name without its content's hash. */
const reexported = (out: string) => modulesOf(out).map(withoutContentHash);

/**
 * The keys a module of keys exports, from the text of the file keys.js names: not one a compile
 * replaced, which stays a while for readers still loading it.
 */
const exportedBy = (out: string, label: string) => {
	const file = modulesOf(out).find(
		(path) => withoutContentHash(path) === `keys/${label}.js`,
	);
	if (file === undefined) throw new Error(`no module ${label}`);
	return [
		...readFileSync(join(out, file), "utf8").matchAll(/^export const (\w+)/gm),
	]
		.map(([, key]) => key)
		.sort();
};

it("holds each saved group's keys in a module of its own, with its declarations beside it, and every other key in its shard", async () => {
	const { dir, compile } = project({
		en: catalogOf("en", 40),
		de: catalogOf("de", 40),
	});
	expect((await compile()).errors).toEqual([]);
	const out = join(dir, "out");
	await saveGroups(out, [["key3", "key7"], ["key12"]]);

	expect((await compile()).errors).toEqual([]);

	expect(reexported(out)).toEqual(["keys/g0.js", "keys/g1.js", "keys/0.js"]);
	expect(exportedBy(out, "g0")).toEqual(["key3", "key7"]);
	expect(exportedBy(out, "g1")).toEqual(["key12"]);
	expect(exportedBy(out, "0")).toHaveLength(37);
	const manifest = await readManifest(join(out, ".grai"));
	const named = [
		...(manifest?.immutable ?? []),
		...Object.keys(manifest?.mutable ?? {}),
	];
	expect(
		named
			.filter((file) => file.startsWith("keys/"))
			.map(withoutContentHash)
			.sort(),
	).toEqual([
		"keys/0.d.ts",
		"keys/0.d.ts.map",
		"keys/0.js",
		"keys/g0.d.ts",
		"keys/g0.d.ts.map",
		"keys/g0.js",
		"keys/g1.d.ts",
		"keys/g1.d.ts.map",
		"keys/g1.js",
	]);
	const { m } = (await import(
		pathToFileURL(join(out, "messages.js")).href
	)) as {
		m: Messages;
	};
	expect(Object.keys(m)).toHaveLength(40);
	expect(m.key7?.({}, { locale: "de" })).toBe("de key7");
	expect(m.key12?.({}, { locale: "de" })).toBe("de key12");
	expect(m.key20?.({}, { locale: "de" })).toBe("de key20");
});

it("writes the output as it was with no groups saved, and compiles again when the groups change", async () => {
	const { dir, compile } = project({
		en: catalogOf("en", 40),
		de: catalogOf("de", 40),
	});
	expect((await compile()).errors).toEqual([]);
	const out = join(dir, "out");
	const ungrouped = readFileSync(join(out, "keys.js"), "utf8");
	expect(reexported(out)).toEqual(["keys/0.js"]);

	await saveGroups(out, [["key3"]]);
	expect((await compile()).written.map(withoutContentHash)).toContain(
		"keys/g0.js",
	);
	await saveGroups(out, []);
	expect((await compile()).written.map(withoutContentHash)).toContain(
		"keys.js",
	);

	expect(readFileSync(join(out, "keys.js"), "utf8")).toBe(ungrouped);
});

it("puts a key no saved group holds in its shard, as one added since, and leaves out a group's key the catalogs lost", async () => {
	const { dir, compile } = project({
		en: catalogOf("en", 40),
		de: catalogOf("de", 40),
	});
	expect((await compile()).errors).toEqual([]);
	const out = join(dir, "out");
	await saveGroups(out, [["gone", "key3"]]);
	writeFileSync(
		join(dir, "messages", "en.json"),
		JSON.stringify({ ...catalogOf("en", 40), added: "en added" }),
	);
	writeFileSync(
		join(dir, "messages", "de.json"),
		JSON.stringify({ ...catalogOf("de", 40), added: "de added" }),
	);

	expect((await compile()).errors).toEqual([]);

	expect(exportedBy(out, "g0")).toEqual(["key3"]);
	expect(exportedBy(out, "0")).toContain("added");
});

it("takes a groups file that is not a list of groups for none", async () => {
	const { dir, compile } = project({ en: catalogOf("en", 4) });
	expect((await compile()).errors).toEqual([]);
	const out = join(dir, "out");
	writeFileSync(join(out, ".grai", "groups.json"), '{"key3": 1');

	expect((await compile()).errors).toEqual([]);

	expect(reexported(out)).toEqual(["keys/0.js"]);
});
