/**
 * The frameworks' own parsers, each loaded the first time a file needs it, from the project's
 * install as an optional peer of grai's: Svelte's `svelte/compiler`, Vue's `vue/compiler-sfc`, the
 * Astro compiler that the project's `astro` depends on, and MDX's `@mdx-js/mdx`. A component is
 * read only through its framework's parser, so a project without it cannot have its components read.
 */

import { createRequire } from "node:module";
import type { AST } from "svelte/compiler";
import { packageDirectory } from "../package-files.ts";

/** A framework whose components grai reads. */
export type Framework = "svelte" | "vue" | "astro" | "mdx";

/** The package that brings each framework's parser. */
const packages: Readonly<Record<Framework, string>> = {
	svelte: "svelte",
	vue: "vue",
	astro: "astro",
	mdx: "@mdx-js/mdx",
};

/** The framework a file is a component of, by its extension, or none for a script. */
export function frameworkOf(path: string): Framework | undefined {
	if (path.endsWith(".svelte")) return "svelte";
	if (path.endsWith(".vue")) return "vue";
	if (path.endsWith(".astro")) return "astro";
	if (path.endsWith(".mdx")) return "mdx";
	return undefined;
}

/** The package a framework's components need, for a message saying to install it. */
export function packageOf(framework: Framework): string {
	return packages[framework];
}

const require = createRequire(packageDirectory);

/**
 * Svelte's parse of a component's tree, or undefined when the project does not install Svelte.
 * grai reads a component's scripts with oxc, so Svelte parses its template alone. Svelte's own
 * preprocessor finds each script, and its content is blanked to spaces, keeping every offset.
 * Svelte would otherwise parse each script with acorn too, which takes most of its time.
 */
export async function svelteParser(): Promise<SvelteParse | undefined> {
	const compiler = await optional(() => import("svelte/compiler"));
	if (compiler === undefined) return undefined;
	const { parse, preprocess } = compiler;
	return async (text) => {
		const { code } = await preprocess(text, {
			script: ({ content }) => ({ code: content.replace(/[^\n\r]/g, " ") }),
		});
		return parse(code, { modern: true });
	};
}

/** Svelte's parse of a component, in its modern tree, its scripts' content left out. */
export type SvelteParse = (text: string) => Promise<AST.Root>;

/** Vue's parser of single-file components, or undefined when the project does not install Vue. */
export async function vueParser(): Promise<
	typeof import("vue/compiler-sfc").parse | undefined
> {
	const compiler = await optional(() => import("vue/compiler-sfc"));
	return compiler?.parse;
}

/** Astro's parser, the one the project's `astro` depends on, or undefined without Astro. */
export async function astroParser(): Promise<AstroParse | undefined> {
	const astro = await optional(async () =>
		require.resolve("astro/package.json"),
	);
	if (astro === undefined) return undefined;
	const compiler = createRequire(astro).resolve("@astrojs/compiler-rs");
	const { parse } = await import(compiler);
	return (text) => parse(text);
}

/**
 * Astro's parse: a component's tree, its frontmatter's and template's code as oxc's ESTree, and
 * its diagnostics.
 */
export type AstroParse = (text: string) => unknown;

/** MDX's parser of a document into its tree, or undefined when the project does not install MDX. */
export async function mdxParser(): Promise<MdxParse | undefined> {
	const mdx = await optional(() => import("@mdx-js/mdx"));
	if (mdx === undefined) return undefined;
	const processor = mdx.createProcessor();
	return (text) => processor.parse(text);
}

/** MDX's parse: a document's tree, with its ESM, expressions and JSX elements. */
export type MdxParse = (text: string) => unknown;

/** A module's import, or undefined when the package is not installed. */
async function optional<T>(load: () => Promise<T>): Promise<T | undefined> {
	try {
		return await load();
	} catch (error) {
		if (isMissing(error)) return undefined;
		throw error;
	}
}

function isMissing(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		(error.code === "ERR_MODULE_NOT_FOUND" || error.code === "MODULE_NOT_FOUND")
	);
}
