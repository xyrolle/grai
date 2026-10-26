import { readFileSync } from "node:fs";
import { dirname, extname, join, relative, sep } from "node:path";
import { type Config, isMissing, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import type { ImportFormat } from "./import/convert.ts";
import { type Mapping, readMapping } from "./import/mapping.ts";
import { formatjsModules } from "./migrate/formatjs.ts";
import { i18nextModules } from "./migrate/i18next.ts";
import type { MessagesImport } from "./migrate/imports.ts";
import type { LibraryModule } from "./migrate/library.ts";
import {
	type LeftUse,
	type MigratedModule,
	type Migration,
	migrateModule,
} from "./migrate/module.ts";
import { nextIntlModules } from "./migrate/next-intl.ts";
import { positionOf, type SourceFile, sourceFiles } from "./sources.ts";
import { writeAll } from "./write-all.ts";

/** The libraries whose calls each import's mapping migrates. */
const librariesOf: Readonly<
	Record<ImportFormat, Readonly<Record<string, LibraryModule>>>
> = {
	i18next: i18nextModules,
	icu: { ...nextIntlModules, ...formatjsModules },
};

/** Components grai migrate reports but does not parse: their markup calls messages too. */
const components = new Set([".svelte", ".vue", ".astro", ".mdx"]);

/** An `import … from "…"` statement, which a component's script writes as a module does. */
const importStatement = /\bimport\b[^;]*?\bfrom\s*(["'])([^"']+)\1/g;

/** A call grai migrate leaves for a person: where it is, from the project's root, and why. */
export type LeftCall = {
	file: string;
	line: number;
	column: number;
	detail: string;
};

/** What a migration rewrote and left, relative to the project's root. */
export type MigrateResult = {
	changed: string[];
	rewritten: number;
	left: LeftCall[];
	errors: GraiError[];
};

/** How i18next's calls that name no namespace are read: the `defaultNS` the app gives i18next. */
export type MigrateOptions = { defaultNamespace?: string | undefined };

/**
 * Rewrites each call under the roots (the project's root by default) of the library whose
 * catalogs grai import converted, as grai.import.json maps it, into a call of its grai message,
 * and reports every call it leaves with why. It writes every changed file or none.
 */
export function migrate(
	configFile: string,
	roots?: readonly string[],
	{ defaultNamespace = "translation" }: MigrateOptions = {},
): MigrateResult {
	let config: Config;
	let mapping: Mapping;
	try {
		config = readConfig(configFile);
		mapping = readMapping(config.root);
	} catch (error) {
		if (!(error instanceof GraiError)) throw error;
		return { changed: [], rewritten: 0, left: [], errors: [error] };
	}
	const libraries = librariesOf[mapping.from];
	const migration = { mapping, libraries, defaultNamespace };
	const next = isNextApp(config.root);
	const texts = new Map<string, string>();
	const left: LeftCall[] = [];
	let rewritten = 0;
	const files = sourceFiles(roots ?? [config.root], config.root, config.outdir);
	for (const source of files) {
		const named = Object.keys(libraries).some((name) =>
			source.text.includes(name),
		);
		if (!named) continue;
		const messages = messagesOf(source.path, config.outdir, next);
		const migrated = migrateSource(source, messages, migration);
		if (migrated.text !== undefined) texts.set(source.path, migrated.text);
		rewritten += migrated.rewritten;
		left.push(...migrated.left.map((use) => leftCall(source, use)));
	}
	writeAll(texts);
	const changed = [...texts.keys()].map((path) => relative(config.root, path));
	return { changed: changed.toSorted(), rewritten, left, errors: [] };
}

/** A module, rewritten; or a component, whose imports of the library are left for a person. */
function migrateSource(
	source: SourceFile,
	messages: MessagesImport,
	migration: Migration,
): MigratedModule {
	if (components.has(extname(source.path))) {
		const left = componentImports(source, migration.libraries);
		return { text: undefined, rewritten: 0, left };
	}
	return migrateModule(source.path, source.text, messages, migration);
}

/** Each import of a library in a component, which grai migrate leaves for a person. */
function componentImports(
	source: SourceFile,
	libraries: Readonly<Record<string, LibraryModule>>,
): LeftUse[] {
	return [...source.text.matchAll(importStatement)]
		.filter(([, , module = ""]) => Object.hasOwn(libraries, module))
		.map(({ index }) => ({
			at: index,
			detail:
				"grai migrate rewrites JavaScript and TypeScript modules: migrate this component's calls by hand.",
		}));
}

/**
 * How a module imports grai's messages, by the path from its directory: `m`, the namespace
 * messages.js exports, or in a Next app the namespace of keys.js. `next dev` builds a namespace
 * that a module re-exports whole, in each layer that imports it and again after each edit, and
 * reads a namespace import of keys.js key by key (`docs/followups.md`).
 */
function messagesOf(
	file: string,
	outdir: string,
	next: boolean,
): MessagesImport {
	const entry = next ? "keys.js" : "messages.js";
	const path = relative(dirname(file), join(outdir, entry))
		.split(sep)
		.join("/");
	return {
		path: path.startsWith(".") ? path : `./${path}`,
		namespace: next,
	};
}

/** Whether the project is a Next app: its package.json depends on `next`. */
function isNextApp(root: string): boolean {
	let manifest: unknown;
	try {
		manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	} catch (error) {
		if (isMissing(error)) return false;
		throw error;
	}
	if (typeof manifest !== "object" || manifest === null) return false;
	return ["dependencies", "devDependencies"].some((field) => {
		const listed: unknown = Reflect.get(manifest, field);
		return typeof listed === "object" && listed !== null && "next" in listed;
	});
}

function leftCall(source: SourceFile, { at, detail }: LeftUse): LeftCall {
	return { file: source.file, ...positionOf(source.text, at), detail };
}
