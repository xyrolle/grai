/**
 * The config's `pathnames`: a route's path in each locale's words (`/about`, and `/ueber-uns` in
 * de), with named segments (`/products/[id]`). Each path is kept as a URL writes it, its words
 * percent-encoded, and compiled into `config.js` as a pattern to match and a path to fill.
 */

import type { GraiError } from "./error.ts";

/** A route, and its path in each locale, in `locales` order: its own where the config gives none. */
export type Pathname = { route: string; paths: readonly string[] };

/** A segment the path fills from the one it is matched against: `[id]`. */
const named = /^\[([A-Za-z_$][\w$]*)\]$/;

/** The config's `pathnames`, checked, each path as a URL writes it. */
export function readPathnames(
	value: unknown,
	locales: readonly string[],
	invalid: (detail: string) => GraiError,
): readonly Pathname[] {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw invalid(
			'"pathnames" must map a route\'s path to its path in each locale, such as { "/about": { "de": "/ueber-uns" } }',
		);
	}
	const pathnames = Object.entries(value).map(([route, translations]) =>
		readPathname(route, translations, locales, invalid),
	);
	locales.forEach((locale, index) => {
		const seen = new Map<string, string>();
		for (const { route, paths } of pathnames) {
			const shape = (paths[index] ?? route).replace(/\[[^\]]*\]/g, "[]");
			const other = seen.get(shape);
			if (other !== undefined) {
				throw invalid(
					`"pathnames" gives ${locale} the path "${decodeURI(paths[index] ?? route)}" for "${other}" and for "${route}". Give each route a path of its own`,
				);
			}
			seen.set(shape, route);
		}
	});
	return pathnames;
}

function readPathname(
	route: string,
	translations: unknown,
	locales: readonly string[],
	invalid: (detail: string) => GraiError,
): Pathname {
	const routeSegments = segmentsOf(route, invalid);
	if (
		typeof translations !== "object" ||
		translations === null ||
		Array.isArray(translations)
	) {
		throw invalid(
			`"pathnames" must give "${route}" its path in each locale, such as { "de": "/ueber-uns" }`,
		);
	}
	const given = new Map(Object.entries(translations));
	for (const [locale, path] of given) {
		if (!locales.includes(locale)) {
			throw invalid(
				`"pathnames" gives "${route}" a path in "${locale}", which is not one of "locales": ${locales.join(", ")}`,
			);
		}
		if (typeof path !== "string") {
			throw invalid(`"pathnames" must give "${route}" in ${locale} a path`);
		}
		const names = namesOf(segmentsOf(path, invalid)).sort().join(", ");
		const routeNames = namesOf(routeSegments).sort().join(", ");
		if (names !== routeNames) {
			throw invalid(
				`"pathnames" gives "${route}" "${path}" in ${locale}, whose segments are ${listed(names)} where the route's are ${listed(routeNames)}. Name the same segments in each`,
			);
		}
	}
	return {
		route: encoded(route),
		paths: locales.map((locale) => {
			const path = given.get(locale);
			return typeof path === "string" ? encoded(path) : encoded(route);
		}),
	};
}

/** A path's segments, or an error for a path a URL cannot write as it is. */
function segmentsOf(
	path: string,
	invalid: (detail: string) => GraiError,
): string[] {
	const segments = path.split("/").slice(1);
	const valid =
		path.startsWith("/") &&
		!/[?#]/.test(path) &&
		segments.every(
			(segment) =>
				segment !== "" && (named.test(segment) || !/[[\]]/.test(segment)),
		);
	if (!valid && path !== "/") {
		throw invalid(
			`"pathnames" maps "${path}", but a path starts with / and has no ?, # or empty segment, and a segment that is [name] is named by a JavaScript identifier`,
		);
	}
	return path === "/" ? [] : segments;
}

function namesOf(segments: readonly string[]): string[] {
	return segments.flatMap((segment) => named.exec(segment)?.[1] ?? []);
}

function listed(names: string): string {
	return names === "" ? "none" : `[${names.split(", ").join("], [")}]`;
}

/** A path as a URL writes it: each word percent-encoded, as a request's path arrives. */
function encoded(path: string): string {
	return path
		.split("/")
		.map((segment) =>
			named.test(segment)
				? segment
				: new URL(`/${segment}`, "http://localhost").pathname.slice(1),
		)
		.join("/");
}

/**
 * What `config.js` holds for the pathnames: the functions that translate a path between a route
 * and a locale's words, from `pathnames.js`, or functions that give a path back as it is.
 */
export function pathnamesModule(pathnames: readonly Pathname[]): string[] {
	if (pathnames.length === 0) {
		return [
			"/** @type {(pathname: string, locale: number) => string} */",
			"export const routePath = (pathname) => pathname;",
			"/** @type {(pathname: string, locale: number) => string} */",
			"export const localePath = (pathname) => pathname;",
		];
	}
	const entries = pathnames.map(
		({ route, paths }) =>
			`\t{ route: ${form(route)}, locales: [${paths.map(form).join(", ")}] },`,
	);
	return [
		'import { pathTranslator } from "./pathnames.js";',
		"export const { routePath, localePath } = pathTranslator([",
		...entries,
		"]);",
	];
}

/** A path as `pathnames.js` reads it: the pattern a path matches, its names, and the path to fill. */
function form(path: string): string {
	const segments = path === "/" ? [] : path.split("/").slice(1);
	const names = namesOf(segments);
	const source = segments
		.map((segment) =>
			named.test(segment)
				? "([^/]+)"
				: segment.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&"),
		)
		.join("\\/");
	return `{ pattern: /^\\/${source}$/, names: ${JSON.stringify(names)}, path: ${JSON.stringify(path)} }`;
}
