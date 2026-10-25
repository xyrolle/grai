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
import { type CompileResult, compile } from "../src/index.ts";

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
			options: object;
			attributes: object;
	  };
export type Messages = Record<string, Message>;

/** The output's runtime, as the tests call it. */
export type Runtime = {
	getLocale(): string;
	setLocale(locale: string, options?: { reload?: boolean }): void;
	localizeHref(href: string, options?: { locale?: string }): string;
	localizeUrl(url: string | URL, options?: { locale?: string }): URL;
	deLocalizeUrl(url: string | URL): URL;
	extractLocaleFromUrl(url: string | URL): string;
	getTextDirection(locale?: string): "ltr" | "rtl";
	localeOfPath(pathname: string): string | undefined;
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
		compile: () => compile(file),
		load: async () => {
			const result = await compile(file);
			expect(result.errors.map((error) => error.message)).toEqual([]);
			const url = (name: string) => pathToFileURL(join(dir, "out", name)).href;
			return {
				m: (await import(url("messages.js"))).m,
				runtime: await import(url("runtime.js")),
			};
		},
	};
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
