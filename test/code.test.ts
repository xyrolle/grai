import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type ModuleCode, readCode } from "../src/code/read.ts";
import { Scopes } from "../src/code/scopes.ts";
import { CodeWriter, fileOffset } from "../src/code/source.ts";
import { childrenOf, type Node } from "../src/code/syntax.ts";

/**
 * Each `m.key` a file's code reads, with where its key's name is in the file and whether `m` there
 * is the module's import, another declaration of the name, or no declaration at all.
 */
async function readsOf(path: string, text: string): Promise<string[]> {
	const modules = await readCode(path, text);
	if (!Array.isArray(modules)) throw new Error(modules.message);
	return modules.flatMap(readsIn(text));
}

function readsIn(text: string) {
	return ({ program, source }: ModuleCode): string[] => {
		const scopes = new Scopes(program);
		const reads: string[] = [];
		const visit = (node: Node) => {
			if (
				node.type === "MemberExpression" &&
				node.object.type === "Identifier" &&
				node.object.name === "m" &&
				node.property.type === "Identifier"
			) {
				const binding = scopes.resolve("m", node.object.start);
				const declaring =
					binding === undefined ? undefined : scopes.parent(binding.node);
				const kind =
					binding === undefined
						? "global"
						: declaring?.type === "ImportSpecifier" ||
								declaring?.type === "ImportNamespaceSpecifier"
							? "import"
							: "local";
				const at = fileOffset(source, node.property.start) ?? -1;
				const before = text.slice(0, at).split("\n");
				const place = `${before.length}:${(before.at(-1)?.length ?? 0) + 1}`;
				reads.push(`${node.property.name} ${place} ${kind}`);
			}
			for (const [, child] of childrenOf(node)) visit(child);
		};
		visit(program);
		return reads;
	};
}

describe("a file's text as a parser decoded its HTML entities", () => {
	it("keeps each stretch the file writes as it is at its place, and a run of entities at its first", () => {
		const file = "<p :x=\"a &amp;&amp; b['tit&#108;e']\">";
		const from = file.indexOf("a ");
		const to = file.lastIndexOf('"');
		const code = new CodeWriter(file)
			.write("(")
			.decoded(from, to, "a && b['title']")
			.code("js");
		const placeOf = (written: string) =>
			fileOffset(code, code.text.indexOf(written));

		expect(code.text).toBe("(a && b['title']");
		expect(placeOf("a ")).toBe(file.indexOf("a "));
		expect(placeOf("&&")).toBe(file.indexOf("&amp;"));
		expect(placeOf(" b")).toBe(file.indexOf(" b"));
		expect(placeOf("'title")).toBe(file.indexOf("'tit"));
		expect(placeOf("le']")).toBe(file.indexOf("&#108;"));
		expect(placeOf("e']")).toBe(file.indexOf("e']"));
		expect(fileOffset(code, code.text.length)).toBe(to);
	});
});

describe("reading a file's code", () => {
	it("reads a script as it is, JSX text and all", async () => {
		const text = `import { m } from "./i18n";\nexport const View = () => <p>don't {m.title()} don't</p>;\n`;

		expect(await readsOf("src/View.jsx", text)).toEqual(["title 2:39 import"]);
	});

	it("reads a Svelte component's scripts and template, with the scopes its blocks open", async () => {
		const text = [
			'<script lang="ts">',
			'\timport { m } from "$lib/i18n";',
			"\tlet { items }: { items: { m: string }[] } = $props();",
			"</script>",
			"<h1 title={m.title()}>{m.heading()}</h1>",
			"{#each items as m, i (m.id)}<p>{m.label}</p>{:else}{m.none()}{/each}",
			"{#await m.load() then m}{m.ok}{:catch m}{m.message}{/await}",
			"{#snippet row(m)}{m.cell}{/snippet}",
			"<List let:m>{m.item}</List>",
			"{#if true}{@const m = { inner: 1 }}{m.inner}{/if}",
			"<p>{m.after()}</p>",
		].join("\n");

		expect(await readsOf("src/App.svelte", text)).toEqual([
			"title 5:14 import",
			"heading 5:26 import",
			"id 6:25 local",
			"label 6:35 local",
			"none 6:55 import",
			"load 7:11 import",
			"ok 7:28 local",
			"message 7:44 local",
			"cell 8:21 local",
			"item 9:16 local",
			"inner 10:39 local",
			"after 11:7 import",
		]);
	});

	it("reads a Svelte each block that names an index and no item, which binds the index alone", async () => {
		const text = [
			"<script>",
			'\timport { m } from "$lib/i18n";',
			"</script>",
			"{#each { length: 3 }, i (i)}<p>{m.row()}</p>{/each}",
			"{#each { length: 3 }, m}{m.toFixed}{/each}",
		].join("\n");

		expect(await readsOf("src/App.svelte", text)).toEqual([
			"row 4:35 import",
			"toFixed 5:28 local",
		]);
	});

	it("reads a Vue component's scripts and template, with v-for's and v-slot's scopes", async () => {
		const text = [
			'<script setup lang="ts">',
			'import { m } from "@/i18n";',
			"const items = [{ m: { label: 1 } }];",
			"</script>",
			"<template>",
			'  <h1 :title="m.title()" @click="m.go(); count++">{{ m.heading() }}</h1>',
			'  <p v-for="(m, i) in items" :key="m.id">{{ m.label }}</p>',
			'  <List v-slot="{ m }">{{ m.slotted }}</List>',
			"  {{ m.after() }}",
			"</template>",
		].join("\n");

		expect(await readsOf("src/App.vue", text)).toEqual([
			"title 6:17 import",
			"go 6:36 import",
			"heading 6:56 import",
			"id 7:38 local",
			"label 7:47 local",
			"slotted 8:29 local",
			"after 9:8 import",
		]);
	});

	it("reads the Vue example's component and the Nuxt example's pages, each key through the namespace it imports", async () => {
		const keysOf = async (path: string) => {
			const text = readFileSync(
				new URL(`../examples/${path}`, import.meta.url),
				"utf8",
			);
			const reads = await readsOf(path, text);
			expect(reads.filter((read) => !read.endsWith(" import"))).toEqual([]);
			return [...new Set(reads.map((read) => read.split(" ")[0]))].toSorted();
		};

		expect(await keysOf("vue/src/App.vue")).toEqual([
			"cart_add",
			"cart_items",
			"drawn_in_browser",
			"greeting",
			"language_switch",
			"terms",
			"title",
		]);
		expect(await keysOf("nuxt/app/pages/index.vue")).toEqual([
			"about_link",
			"cart_add",
			"cart_items",
			"delivery_link",
			"drawn_in_browser",
			"greeting",
			"terms",
			"title",
		]);
		expect(await keysOf("nuxt/app/pages/about.vue")).toEqual([
			"about_body",
			"about_title",
			"home_link",
		]);
		expect(await keysOf("nuxt/app/pages/delivery.vue")).toEqual([
			"delivery_estimate",
			"delivery_title",
		]);
	});

	it("reads an Astro component's frontmatter and template as one module, and each script as its own", async () => {
		const text = [
			"---",
			'import { m } from "../i18n";',
			"const é = 1;",
			"---",
			"<h1 title={m.title()}>é {m.heading()}</h1>",
			"<ul>{items.map((m) => <li>{m.id}</li>)}</ul>",
			"<script>",
			'import { m } from "../i18n";',
			"console.log(m.client());",
			"</script>",
		].join("\n");

		expect(await readsOf("src/Page.astro", text)).toEqual([
			"title 5:14 import",
			"heading 5:28 import",
			"id 6:30 local",
			"client 9:15 import",
		]);
	});

	it("reads an MDX document's imports, expressions, attributes and spreads", async () => {
		const text = [
			'import { m } from "../i18n";',
			"export const meta = { title: m.title() };",
			"",
			"# Héllo {m.heading()}",
			"",
			"Don't stop {m.text()}.",
			"",
			"<Chart data={m.data} {...m.rest} />",
			"",
			"{items.map((m) => m.id)}",
		].join("\n");

		expect(await readsOf("src/post.mdx", text)).toEqual([
			"title 2:32 import",
			"heading 4:12 import",
			"text 6:15 import",
			"data 8:16 import",
			"rest 8:28 import",
			"id 10:21 local",
		]);
	});

	it("gives a file that does not parse as its error, at its place", async () => {
		expect(await readCode("src/a.ts", "const = 1;\n")).toEqual({
			at: 6,
			message: "Unexpected token",
		});
		expect(
			await readCode("src/App.svelte", "<p>{m.title(</p>\n"),
		).toMatchObject({ at: 12 });
		// A component's script is oxc's to parse, as Svelte parses its template alone.
		expect(
			await readCode("src/App.svelte", "<script>\n\tconst = 1;\n</script>\n"),
		).toEqual({ at: 16, message: "Unexpected token" });
	});
});
