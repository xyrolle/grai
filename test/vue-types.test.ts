import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, it } from "vitest";
import { compile } from "../src/index.ts";

// vue-tsc, the type checker of Vue apps, on templates that call messages and draw markup. The
// project sits inside the Vue example, which has vue, vue-tsc and grai installed.
const example = fileURLToPath(new URL("../examples/vue/", import.meta.url));
const vueTsc = join(example, "node_modules/.bin/vue-tsc");

const components = {
	"Messages.vue": `<script setup lang="ts">
import { m } from "./out/messages.js";
</script>

<template>
	<p>{{ m.title() }}</p>
	<p>{{ m.title({ count: 1 }) }}</p>
	<p>{{ m.cart_items({ count: 1 }) }}</p>
</template>
`,
	"Terms.vue": `<script setup lang="ts">
import { Markup } from "grai/vue";
import { h } from "vue";
import { m } from "./out/messages.js";
</script>

<template>
	<Markup :parts="m.terms.parts()" :markup="{ link: (children) => h('a', children) }" />
	<Markup :parts="m.terms.parts()" :markup="{}" />
	<Markup :parts="m.terms.parts()" :markup="{ link: () => h('a'), b: () => h('b') }" />
</template>
`,
};

let dir: string;
/** Each type error, as its file and line. */
let errors: string[];
beforeAll(async () => {
	dir = mkdtempSync(join(example, ".types-"));
	mkdirSync(join(dir, "messages"));
	writeFileSync(
		join(dir, "messages", "en.json"),
		JSON.stringify({
			title: "Your cart",
			cart_items: "{count} items",
			terms: "Read the {#link}terms{/link}.",
		}),
	);
	const config = join(dir, "grai.config.json");
	writeFileSync(
		config,
		JSON.stringify({
			locales: ["en"],
			baseLocale: "en",
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
	);
	await compile(config);
	for (const [file, source] of Object.entries(components))
		writeFileSync(join(dir, file), source);
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: {
				target: "es2024",
				module: "esnext",
				moduleResolution: "bundler",
				strict: true,
				skipLibCheck: true,
				noEmit: true,
			},
			include: ["*.vue"],
		}),
	);
	// Run in the project, so that each error names its file as the regular expression reads it.
	const checked = promisify(execFile)(
		vueTsc,
		["-p", ".", "--pretty", "false"],
		{ cwd: dir },
	);
	const output = await checked.then(
		() => "",
		(error: { stdout: string }) => error.stdout,
	);
	errors = [...output.matchAll(/^(\w+\.vue)\((\d+),\d+\): error/gm)].map(
		([, file, line]) => `${file}:${line}`,
	);
}, 60_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("rejects inputs in a template for a message that takes none", () => {
	expect(errors.filter((error) => error.startsWith("Messages.vue"))).toEqual([
		"Messages.vue:7",
	]);
});

it("has Markup's map name exactly the elements a compiled message writes", () => {
	expect(errors.filter((error) => error.startsWith("Terms.vue"))).toEqual([
		"Terms.vue:9",
		"Terms.vue:10",
	]);
});
