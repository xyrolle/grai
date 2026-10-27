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
import { writeSources } from "./sources.ts";

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
