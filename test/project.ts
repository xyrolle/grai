import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, onTestFinished } from "vitest";
import { compileCatalogs } from "../src/compilation.ts";
import { parseCatalogs, readProject } from "../src/compile.ts";
import { withoutContentHash } from "../src/content-names.ts";
import { type CompileResult, compile } from "../src/index.ts";
import { readManifest } from "../src/manifest.ts";
import { unrecordedCalls } from "./recorded-names.ts";

/**
 * A temporary project of catalogs by locale, the first locale its base, each laid out one entry
 * per line as editors write them. It is removed after the test.
 */
export type Project = {
	dir: string;
	config: string;
	compile: () => Promise<CompileResult>;
	/** Compiles, expecting no error, and imports the output's `m` namespace and runtime. */
	load: () => Promise<{ m: Messages; runtime: Runtime }>;
};

/** A compiled message, as the test calls it. */
export type Message = ((
	inputs?: object,
	options?: { locale?: string },
) => string) & {
	parts?: (inputs?: object, options?: { locale?: string }) => Part[];
};

/** A run of a markup message's text, or a piece of its markup. */
export type Part =
	| { type: "text"; value: string }
	| {
			type: "markup-start" | "markup-end" | "markup-standalone";
			name: string;
			options: Readonly<Record<string, unknown>>;
			attributes: Readonly<Record<string, string | true>>;
	  };
export type Messages = Record<string, Message>;

/** The output's runtime, as the tests call it. */
export type Runtime = {
	GraiError: new (code: string, message: string) => Error & { code: string };
	getLocale(): string;
	setLocale(locale: string, options?: { reload?: boolean }): void;
	localizeHref(href: string, options?: { locale?: string }): string;
	localizeUrl(url: string | URL, options?: { locale?: string }): URL;
	deLocalizeUrl(url: string | URL): URL;
	extractLocaleFromUrl(url: string | URL): string;
	getTextDirection(locale?: string): "ltr" | "rtl";
};

/**
 * What a test's dev server leaves Vite's watcher off: the files written just before the server
 * starts, a project's package.json and tsconfig.json, and a test's page, entry and render module.
 * macOS reports files written that late as changed once the watcher runs (14 of 20 trials, about
 * 110 ms after the start). Vite then reloads the page, or keeps the reload for the page that
 * connects next; for tsconfig.json it also drops every module it evaluated, so a server's program
 * runs again. Tests edit catalogs and the config only, which Vite still watches, so a test still
 * sees a reload the plugin would let through.
 */
export const fixtures: { ignored: string[] } = {
	ignored: [
		"**/index.html",
		"**/main.js",
		"**/package.json",
		"**/render.js",
		"**/tsconfig.json",
	],
};

export function project(
	catalogs: Record<string, unknown>,
	config: Record<string, unknown> = {},
): Project {
	// Its real path: the temporary directory can be a symlink (macOS's /var), and a module imported
	// through it and through its real path would be two modules.
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-")));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	mkdirSync(join(dir, "messages"));
	for (const [locale, catalog] of Object.entries(catalogs)) {
		writeFileSync(
			join(dir, "messages", `${locale}.json`),
			JSON.stringify(catalog, null, "\t"),
		);
	}
	const locales = Object.keys(catalogs);
	// What a project's imports resolve by: a key's own path mapped to keys.js, and `$lib`, as an
	// app declares them for TypeScript and Node.
	const outdir = typeof config.outdir === "string" ? config.outdir : "out";
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			type: "module",
			imports: { "#i18n/messages/*": `./${outdir}/keys.js` },
		}),
	);
	writeFileSync(
		join(dir, "tsconfig.json"),
		JSON.stringify({
			compilerOptions: { paths: { "$lib/*": ["./src/lib/*"] } },
		}),
	);
	const file = join(dir, "grai.config.json");
	writeFileSync(
		file,
		JSON.stringify({
			locales,
			baseLocale: locales[0],
			catalogs: "messages/{locale}.json",
			outdir: "out",
			...config,
		}),
	);
	return {
		dir,
		config: file,
		compile: () => checkedCompile(file),
		load: async () => {
			const result = await checkedCompile(file);
			expect(result.errors.map((error) => error.message)).toEqual([]);
			const url = (name: string) => pathToFileURL(join(dir, "out", name)).href;
			return {
				m: (await import(url("messages.js"))).m,
				runtime: await import(url("runtime.js")),
			};
		},
	};
}

/**
 * Compiles, and when the catalogs compile, checks that each key's code calls only the names it
 * records, and that a compile that leaves the declarations to the output's write, as a dev server's
 * first does, gives every key the same code, so that every test's catalog checks both.
 */
async function checkedCompile(config: string): Promise<CompileResult> {
	const result = await compile(config);
	if (result.errors.length > 0) return result;
	// Compiled again in memory, so that the check writes nothing a test may look at.
	const read = await readProject(config);
	if ("errors" in read) return result;
	const { catalogs, errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return result;
	const { keys } = compileCatalogs(read.config, catalogs);
	expect(unrecordedCalls(keys)).toEqual([]);
	const undeclared = compileCatalogs(read.config, catalogs, undefined, {
		declare: false,
	});
	expect(undeclared.keys).toEqual(
		new Map(
			[...keys].map(([key, { declared: _declared, ...compiled }]) => [
				key,
				compiled,
			]),
		),
	);
	return result;
}

/** Compiles and returns each error's code and message, in the order reported. */
export async function errorsOf(
	catalogs: Record<string, unknown>,
	config?: Record<string, unknown>,
): Promise<string[]> {
	const result = await project(catalogs, config).compile();
	return result.errors.map((error) => `${error.code}: ${error.message}`);
}

/** What a call throws, for a test to match its name, code and message. */
export function thrown(call: () => unknown): unknown {
	try {
		call();
	} catch (error) {
		return error;
	}
	throw new Error("expected the call to throw");
}

/**
 * The path of a file of a project's output whose name carries the hash of its content, by its
 * name without it: `formats.js` for the output's `formats-1f0c….js`, `keys/0.js` for a shard's.
 */
export async function outputFile(dir: string, name: string): Promise<string> {
	const manifest = await readManifest(join(dir, "out", ".grai"));
	const file = [
		...(manifest?.immutable ?? []),
		...Object.keys(manifest?.mutable ?? {}),
	].find((file) => file !== name && withoutContentHash(file) === name);
	if (file === undefined) throw new Error(`the output has no ${name}`);
	return join(dir, "out", file);
}
