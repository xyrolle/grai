import {
	mkdtempSync,
	realpathSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { check } from "../src/check.ts";
import { project } from "./project.ts";
import { installPackage, packageApp, writeSources } from "./sources.ts";

/** The problems check reports for the catalogs, with a source that names each key. */
async function problemsOf(
	catalogs: Record<string, unknown>,
): Promise<string[]> {
	const { dir, config } = project(catalogs);
	writeFileSync(
		join(dir, "app.ts"),
		'import { m } from "./out/messages.js";\nm.invited(); m.files();\n',
	);
	const { problems } = await check(config);
	return problems.map((error) => error.message);
}

describe("grai check's inputs", () => {
	it("takes an input a locale only chooses by as its grammar, which another locale need not read", async () => {
		const invited = [
			{
				declarations: ["input name", "input gender"],
				selectors: ["gender"],
				match: {
					"gender=female": "Vous êtes invitée, {name}",
					"gender=*": "Vous êtes invité, {name}",
				},
			},
		];

		expect(
			await problemsOf({
				en: { invited: "You're invited, {name}", files: "Files" },
				fr: { invited, files: "Fichiers" },
			}),
		).toEqual([]);
	});

	it("reports a locale that only chooses by an input another shows, as a placeholder it lost", async () => {
		const files = [
			{
				declarations: ["input count", "local countPlural = count: plural"],
				selectors: ["countPlural"],
				match: {
					"countPlural=one": "Un fichier",
					"countPlural=*": "Des fichiers",
				},
			},
		];

		expect(
			await problemsOf({
				en: { invited: "You're invited", files: "{count} files" },
				fr: { invited: "Vous êtes invité", files },
			}),
		).toEqual([
			'messages/fr.json: "files" (fr): the message never shows {count}, which en shows. Show it here too, or drop it everywhere.',
		]);
	});
});

describe("grai check's reads of components", () => {
	it("reads a Vue template's expressions as Vue decodes their HTML entities, each place where the file writes it", async () => {
		const { dir, config } = project({
			en: { title: "Title" },
			de: { title: "Titel" },
		});
		writeSources(dir, {
			"src/Page.vue": [
				"<script setup>",
				'import { m } from "../out/messages.js";',
				"</script>",
				`<template><p :title="m['tit&#108;e']()">{{ m.title() &amp;&amp; m.absent() }}</p></template>`,
				"",
			].join("\n"),
		});

		const { problems } = await check(config);

		expect(problems.map(({ message }) => message)).toEqual([
			'src/Page.vue:4:67: "absent": m.absent names a key no catalog has. Add it with grai add absent --en "…" --de "…", or fix the name.',
		]);
	});

	it("reads a Nuxt app's pages and a Vue component through the aliases Nuxt generates", async () => {
		const { dir, config } = project(
			{
				en: { title: "Title", about_title: "About", unused: "Unused" },
				de: { title: "Titel", about_title: "Über", unused: "Unbenutzt" },
			},
			{ outdir: "app/i18n" },
		);
		writeSources(dir, {
			"tsconfig.json": JSON.stringify({
				files: [],
				references: [{ path: "./.nuxt/tsconfig.app.json" }],
			}),
			".nuxt/tsconfig.app.json": JSON.stringify({
				compilerOptions: { paths: { "~/*": ["../app/*"] } },
				include: ["../app/**/*", "../app/**/*.vue"],
			}),
			"app/pages/index.vue": [
				'<script setup lang="ts">',
				'import * as m from "~/i18n/keys.js";',
				"const others = [{ name: 1 }];",
				"</script>",
				"<template>",
				"\t<h1>{{ m.title() }}</h1>",
				'\t<a v-for="other in others" :key="other.name">{{ m.titel() }}</a>',
				"</template>",
				"",
			].join("\n"),
			"app/components/About.vue": [
				"<script setup>",
				'import { about_title } from "~/i18n/keys.js";',
				"</script>",
				"<template><h2>{{ about_title() }}</h2></template>",
				"",
			].join("\n"),
		});

		const { problems } = await check(config);

		expect(problems.map(({ message }) => message)).toEqual([
			'app/components/About.vue:2:29: imports about_title from keys.js, though package.json gives each key its own path: a mock of "#i18n/messages/about_title.js" reaches only the files that import the key by that path. Import each from its own path, as grai check --fix does.',
			'app/pages/index.vue:7:52: "titel": m.titel names a key no catalog has. Add it with grai add titel --en "…" --de "…", or fix the name.',
			'messages/en.json: "unused": no shipped code under . reads the key. Remove it from every catalog, or use it.',
		]);
	});

	it("reads an MDX document whose expressions hold only a comment, as MDX compiles them to nothing", async () => {
		const { dir, config } = project({
			en: { title: "Title" },
			de: { title: "Titel" },
		});
		writeSources(dir, {
			"src/page.mdx": [
				'import { m } from "../out/messages.js"',
				"",
				"{/* A translator note */}",
				"",
				"# {m.title()} {/* inline */}",
				"",
			].join("\n"),
		});

		const { problems } = await check(config);

		expect(problems.map(({ message }) => message)).toEqual([]);
	});
});

describe("grai check's loads", () => {
	it("takes a call of a `require` the module declares itself, a callback's parameter, for no load", async () => {
		const { dir, config } = project({
			en: { title: "Title" },
			de: { title: "Titel" },
		});
		writeSources(dir, {
			"src/load.js": [
				'import { m } from "../out/messages.js";',
				"m.title();",
				'export const f = require => require("#i18n/messages/absent.js");',
				"",
			].join("\n"),
		});

		const { problems } = await check(config);

		expect(problems).toEqual([]);
	});
});

describe("grai check's modules, named as the bundler names them", () => {
	it("reads a namespace imported as `__proto__` alike with its facts read again and from the cache", async () => {
		const { dir, config } = project({
			en: { title: "Title" },
			de: { title: "Titel" },
		});
		writeSources(dir, {
			"src/page.js":
				'import * as __proto__ from "../out/messages.js";\n__proto__.m.title();\n',
		});

		const cold = await check(config);
		const warm = await check(config);

		expect(cold.problems).toEqual([]);
		expect(warm.problems).toEqual([]);
	});

	it("reads a project reached through a symlink, its modules named by their real paths, so its imports of the output are reads", async () => {
		const { dir } = project({ en: { title: "Title", unused: "Unused" } });
		writeSources(dir, {
			"src/lib/i18n.ts": 'export { m } from "../../out/messages.js";\n',
			"src/app.ts": [
				'import { title } from "#i18n/messages/title.js";',
				'import { m } from "$lib/i18n";',
				"title();",
				"m.title();",
				"",
			].join("\n"),
		});
		const link = join(
			realpathSync(mkdtempSync(join(tmpdir(), "grai-link-"))),
			"app",
		);
		onTestFinished(() =>
			rmSync(dirname(link), { recursive: true, force: true }),
		);
		symlinkSync(dir, link);

		const { problems } = await check(join(link, "grai.config.json"));

		expect(problems.map(({ message }) => message)).toEqual([
			'messages/en.json: "unused": no shipped code under . reads the key. Remove it from every catalog, or use it.',
		]);
	});
});

describe("grai check's reads of a Svelte component's scripts", () => {
	it("reads a Svelte component's instance script and template in a scope of their own, inside its module script's", async () => {
		const { dir, config } = project({
			en: { title: "Title", subtitle: "Subtitle", note: "Note" },
			de: { title: "Titel", subtitle: "Untertitel", note: "Hinweis" },
		});
		writeSources(dir, {
			"src/Labelled.svelte": [
				"<script module>",
				"\texport const kind = 1;",
				"</script>",
				"<script>",
				'\timport { m } from "../out/messages.js";',
				"\texport let label = m.subtitle();",
				"\tconst noted = () => m.note();",
				"\texport { noted };",
				"</script>",
				"<p>{label} {noted()}</p>",
				"",
			].join("\n"),
			"src/Heading.svelte": [
				"<script module>",
				'\timport * as messages from "../out/messages.js";',
				"\tconst m = messages.m;",
				"\texport const heading = () => m.title();",
				"</script>",
				"<script>",
				'\tconst m = { local: () => "local" };',
				"</script>",
				"<p>{m.local()}</p>",
				"",
			].join("\n"),
		});

		const { problems } = await check(config);

		expect(problems.map(({ message }) => message)).toEqual([]);
	});
});

describe("grai check's reads of a Svelte component in Svelte's async mode", () => {
	it("reads a component that awaits in a snippet and in an each block, as Svelte's async mode lets it", async () => {
		const { dir, config } = project({
			en: { title: "Title", unread: "Unread" },
		});
		writeSources(dir, {
			"src/App.svelte": [
				'<script lang="ts">',
				'\timport { m } from "../out/messages.js";',
				"\tconst items = [1, 2];",
				"\tconst load = async (n: number) => n * 2;",
				"</script>",
				"",
				"<h1>{m.title()}</h1>",
				"",
				"{#snippet panel()}",
				'\t{@const { default: Panel } = await import("./Panel.svelte")}',
				"\t<Panel />",
				"{/snippet}",
				"{@render panel()}",
				"",
				"{#each items as item}",
				"\t<p>{await load(item)}</p>",
				"{/each}",
				"",
			].join("\n"),
			"src/Panel.svelte": "<p>panel</p>\n",
		});

		const { problems } = await check(config);

		expect(problems.map(({ message }) => message)).toEqual([
			'messages/en.json: "unread": no shipped code under . reads the key. Remove it from every catalog, or use it.',
		]);
	});
});

describe("grai check's reads of a project that installs grai", () => {
	it("reads a project that imports the package's entries by its name", async () => {
		const { dir, config } = project({
			en: {
				cart_title: "Your cart",
				cart_terms: "Read the {#b}terms{/b}",
				unused: "Unused",
			},
		});
		writeSources(dir, packageApp);
		installPackage(dir);

		const { problems } = await check(config);

		expect(problems.map(({ message }) => message)).toEqual([
			'messages/en.json: "unused": no shipped code under . reads the key. Remove it from every catalog, or use it.',
		]);
	});
});
