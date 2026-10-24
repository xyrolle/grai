import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { Catalog } from "./catalog.ts";
import { compileCatalogs } from "./compilation.ts";
import { parseCatalogs, readProject } from "./compile.ts";
import type { Config } from "./config.ts";
import { GraiError, sortErrors } from "./error.ts";
import { parseMessage } from "./message.ts";
import { MessageProblem } from "./problem.ts";

/** Files that can name a message: JavaScript, TypeScript and the components of Svelte and Vue. */
const sourceExtensions = new Set([
	".js",
	".mjs",
	".cjs",
	".jsx",
	".ts",
	".mts",
	".cts",
	".tsx",
	".svelte",
	".vue",
]);
/** Directories of dependencies and of build output, which name no message of the project's own. */
const skippedDirectories = new Set(["node_modules", "dist", "build"]);
const identifier = /[A-Za-z_$][\w$]*/g;

/**
 * Every problem of a project, without writing anything: each error a compile would report, each
 * key no source file names, and each input one locale reads and another never does. Source files
 * are those under the project's root, or under `sources` when given, outside the outdir,
 * dependencies, build output and dot-directories.
 */
export async function check(
	configFile: string,
	sources?: readonly string[],
): Promise<GraiError[]> {
	const read = await readProject(configFile);
	if ("errors" in read) return read.errors;
	const { catalogs, errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return errors;
	const { config } = read;
	const compilation = compileCatalogs(config, catalogs);
	const roots = sources ?? [config.root];
	const names = namesIn(roots, config.outdir);
	const problems = [...compilation.errors];
	for (const key of compilation.keys.keys()) {
		if (!names.has(key)) problems.push(unused(key, config, catalogs, roots));
		problems.push(...differingInputs(key, catalogs));
	}
	return sortErrors(problems);
}

/** Every identifier written in the source files under the roots. */
function namesIn(roots: readonly string[], outdir: string): Set<string> {
	const names = new Set<string>();
	const visit = (path: string) => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const child = join(path, entry.name);
			if (entry.isDirectory()) {
				const skipped =
					entry.name.startsWith(".") ||
					skippedDirectories.has(entry.name) ||
					child === outdir;
				if (!skipped) visit(child);
			} else if (sourceExtensions.has(extname(entry.name))) {
				for (const [name] of readFileSync(child, "utf8").matchAll(identifier))
					names.add(name);
			}
		}
	};
	for (const root of roots) visit(root);
	return names;
}

function unused(
	key: string,
	config: Config,
	catalogs: readonly Catalog[],
	roots: readonly string[],
): GraiError {
	const base = catalogs.find((catalog) => catalog.locale === config.baseLocale);
	const where = roots
		.map((root) => relative(config.root, root) || ".")
		.join(", ");
	return new GraiError(
		"key-unused",
		{ file: base?.file ?? "", key },
		`no source file under ${where} names the key. Remove it from every catalog, or use it.`,
	);
}

/** An error for each locale that never reads an input another locale reads. */
function differingInputs(
	key: string,
	catalogs: readonly Catalog[],
): GraiError[] {
	const inputs = new Map<Catalog, ReadonlySet<string>>();
	for (const catalog of catalogs) {
		try {
			inputs.set(
				catalog,
				parseMessage(catalog.locale, catalog.messages.get(key)).inputs,
			);
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			return [];
		}
	}
	const all = new Set([...inputs.values()].flatMap((names) => [...names]));
	return [...inputs].flatMap(([catalog, names]) => {
		const missing = [...all].filter((name) => !names.has(name));
		if (missing.length === 0) return [];
		const readers = [...inputs]
			.filter(([, other]) => missing.some((name) => other.has(name)))
			.map(([other]) => other.locale);
		return [
			new GraiError(
				"inputs-differ",
				{ file: catalog.file, key, locale: catalog.locale },
				`the message never reads ${missing.map((name) => `{${name}}`).join(", ")}, which ${readers.join(", ")} read${readers.length === 1 ? "s" : ""}. Read it here too, or drop it everywhere.`,
			),
		];
	});
}
