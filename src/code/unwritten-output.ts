/**
 * Where an import of grai's output resolves while the output is not written yet, as on a fresh
 * clone's first `next dev` start, whose read of the app's code runs beside the compile that writes
 * it (`next/first-groups.ts`). The resolver finds no file then, so an import it leaves unresolved is
 * taken through the resolver's own steps, in its order, to the file each gives where that file is
 * not there yet (`resolution.ts`): the first Vite alias that matches; a relative or absolute path;
 * the tsconfig's `paths` that apply, by the pattern that matches best, each target in turn; its
 * `baseUrl`; and the `imports` of the importing module's own package.json, by the key that matches
 * best, through the first of its conditions the resolver takes. One that lands on none of the
 * output's modules names nothing, as the resolver said. A module of a project the tsconfig references is left unresolved: whether the
 * resolver gives it that project's `paths` depends on the project's `include`.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathNames } from "./candidates.ts";
import type { Output } from "./modules.ts";
import { aliased, conditionNames, type Resolution } from "./resolution.ts";
import { appliedPaths } from "./tsconfig-paths.ts";

/** No folder's package.json names the output as its entry: the app imports its modules by path. */
const entries: ReadonlySet<string> = new Set();

export function unwrittenOutput(
	output: Output,
	resolution: Resolution,
): (source: string, importer: string) => string | undefined {
	const modules = [output.keys, output.messages];
	const landed = (path: string) =>
		modules.find((module) => pathNames(path, module, entries));
	const applied =
		resolution.tsconfig === undefined
			? { paths: [], baseUrl: undefined, references: [] }
			: appliedPaths(resolution.tsconfig);
	const scopes = new PackageScopes();
	return (source, importer) => {
		if (applied === undefined) return undefined;
		const { paths, baseUrl, references } = applied;
		if (references.some((project) => importer.startsWith(`${project}/`)))
			return undefined;
		const specifier = aliased(resolution.aliases, source);
		if (specifier.startsWith(".") || isAbsolute(specifier))
			return landed(resolve(dirname(importer), specifier));
		const matched = bestMatch(
			paths.map(({ key }) => key),
			specifier,
		);
		const targets =
			matched === undefined
				? []
				: (paths.find(({ key }) => key === matched.key)?.targets ?? []);
		for (const target of targets) {
			const module = landed(target.replace("*", matched?.star ?? ""));
			if (module !== undefined) return module;
		}
		if (baseUrl !== undefined) {
			const module = landed(join(baseUrl, specifier));
			if (module !== undefined) return module;
		}
		if (!specifier.startsWith("#")) return undefined;
		const target = scopes.importTarget(dirname(importer), specifier);
		return target === undefined ? undefined : landed(target);
	};
}

/** A package.json's directory and its `imports`. */
type Scope = { directory: string; imports: unknown };

/**
 * The package.json files of the importing modules' scopes, each read once: the nearest one above a
 * module, whose `imports` alone its `#` specifiers go through.
 */
class PackageScopes {
	#scopes = new Map<string, Scope | undefined>();

	/** The path a `#` specifier's import names, from a module in `directory`, or none. */
	importTarget(directory: string, specifier: string): string | undefined {
		const scope = this.#scopeOf(directory);
		if (scope === undefined || !isRecord(scope.imports)) return undefined;
		const matched = bestMatch(Object.keys(scope.imports), specifier);
		if (matched === undefined) return undefined;
		const target = conditionTarget(scope.imports[matched.key]);
		if (target === undefined || !target.startsWith("./")) return undefined;
		return resolve(scope.directory, target.replaceAll("*", matched.star));
	}

	#scopeOf(directory: string): Scope | undefined {
		if (this.#scopes.has(directory)) return this.#scopes.get(directory);
		let scope: Scope | undefined;
		let text: string | undefined;
		try {
			text = readFileSync(join(directory, "package.json"), "utf8");
		} catch {
			const parent = dirname(directory);
			scope = parent === directory ? undefined : this.#scopeOf(parent);
		}
		if (text !== undefined) {
			let manifest: unknown;
			try {
				manifest = JSON.parse(text);
			} catch {}
			scope = {
				directory,
				imports: isRecord(manifest) ? manifest.imports : undefined,
			};
		}
		this.#scopes.set(directory, scope);
		return scope;
	}
}

/**
 * The key that matches a specifier best, as TypeScript and Node take one: the key that is the
 * specifier, or else the pattern whose text before `*` is the longest, the longer key of two alike,
 * and what its `*` takes.
 */
function bestMatch(
	keys: readonly string[],
	specifier: string,
): { key: string; star: string } | undefined {
	let best: { key: string; star: string; prefix: number } | undefined;
	for (const key of keys) {
		const star = key.indexOf("*");
		if (star === -1) {
			if (key === specifier) return { key, star: "" };
			continue;
		}
		const before = key.slice(0, star);
		const after = key.slice(star + 1);
		const better =
			best === undefined ||
			before.length > best.prefix ||
			(before.length === best.prefix && key.length > best.key.length);
		if (
			better &&
			specifier.length >= before.length + after.length &&
			specifier.startsWith(before) &&
			specifier.endsWith(after)
		) {
			best = {
				key,
				star: specifier.slice(before.length, specifier.length - after.length),
				prefix: before.length,
			};
		}
	}
	return best;
}

/**
 * The target an `imports` value gives, as the resolver takes it: a path; the first of an array's
 * that gives one; or the first condition, in the object's order, that the resolver takes and that
 * gives one, where a `null` target gives none.
 */
function conditionTarget(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) {
		for (const each of value) {
			const target = conditionTarget(each);
			if (target !== undefined) return target;
		}
		return undefined;
	}
	if (!isRecord(value)) return undefined;
	for (const [condition, target] of Object.entries(value)) {
		if (!conditionNames.includes(condition)) continue;
		if (target === null) return undefined;
		const taken = conditionTarget(target);
		if (taken !== undefined) return taken;
	}
	return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
