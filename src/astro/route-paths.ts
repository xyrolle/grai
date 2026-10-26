// Astro's own reading of a page's `getStaticPaths()`: the checks it makes of what the function
// gives, the path it writes from each entry's params, and the `paginate` it passes in. grai runs a
// page's `getStaticPaths()` to find the pages a static build writes in a locale's words, and Astro
// exports none of these, so they are written here as Astro writes them. `test/astro-paths.test.ts`
// runs each beside Astro's own, from the installed astro (7.4), so a change in Astro's fails grai's
// tests rather than an app's build.

/** A part of a route's segment, as Astro's routes give it: `[id]` is `{ content: "id", dynamic }`. */
export type RoutePart = { content: string; dynamic: boolean; spread: boolean };

/** A route as `paginate` and the path writing read it: its segments and its parameters' names. */
export type RouteShape = {
	segments: readonly (readonly RoutePart[])[];
	params: readonly string[];
};

/** An entry of what `getStaticPaths()` gives. */
export type StaticPath = { params: Record<string, unknown>; props?: unknown };

/** What a page's `getStaticPaths()` is given. */
export type StaticPathsOptions = {
	paginate: Paginate;
	routePattern: string;
};

type Paginate = (
	data: readonly unknown[],
	options?: {
		pageSize?: number;
		params?: Record<string, string | undefined>;
		props?: Record<string, unknown>;
		format?: (url: string) => string;
	},
) => StaticPath[];

/** What `getStaticPaths()` gave, checked as Astro checks it: a list of entries, each with params. */
export function checkedStaticPaths(result: unknown): StaticPath[] {
	if (!Array.isArray(result)) {
		throw new Error(
			`Invalid type returned by \`getStaticPaths()\`. Expected an \`array\`, got \`${typeof result}\`.`,
		);
	}
	for (const entry of result) {
		if (Array.isArray(entry) || entry === null) {
			const type = Array.isArray(entry) ? "array" : typeof entry;
			throw new Error(
				`Invalid entry returned by \`getStaticPaths()\`. Expected an object, got \`${type}\`.`,
			);
		}
		const { params } = entry;
		if (
			params === undefined ||
			params === null ||
			(params && Object.keys(params).length === 0)
		) {
			throw new Error(
				"Missing or empty required `params` property on `getStaticPaths()` route.",
			);
		}
	}
	return result;
}

/** A page's path for an entry's params, as Astro's `stringifyParams` writes it. */
export function pathOfParams(
	params: Record<string, unknown>,
	route: RouteShape,
	trailingSlash: string,
): string {
	const given: Record<string, string> = {};
	for (const [key, value] of Object.entries(params)) {
		if (typeof value !== "string" && value !== undefined) {
			throw new Error(
				`Invalid \`getStaticPaths()\` route parameter for \`${key}\`. Expected a string or undefined, received \`${typeof value}\` (\`${value}\`).`,
			);
		}
		if (value !== undefined) given[key] = value.replace(/^\/|\/$/g, "");
	}
	return generatedPath(route, given, trailingSlash);
}

/** Astro's `paginate` for a route, whose pages' params and URLs it writes. */
export function paginateFor(
	route: RouteShape,
	base: string,
	trailingSlash: string,
): Paginate {
	return (data, options = {}) => {
		const { pageSize = 10, params = {}, props = {} } = options;
		const format = options.format || ((url: string) => url);
		const size = pageSize || 10;
		const firstNumbered = !route.params.includes("...page");
		if (firstNumbered && !route.params.includes("page")) {
			throw new Error(
				"[paginate()] page number param `page` not found in your filepath.",
			);
		}
		const last = Math.max(1, Math.ceil(data.length / size));
		const pageParam = (page: number) =>
			firstNumbered || page > 1 ? String(page) : undefined;
		const url = (page: number) =>
			format(
				withBase(
					base,
					generatedPath(
						route,
						{ ...params, page: pageParam(page) },
						trailingSlash,
					),
				),
			);
		return Array.from({ length: last }, (_, index) => {
			const page = index + 1;
			const start = size === Number.POSITIVE_INFINITY ? 0 : (page - 1) * size;
			const end = Math.min(start + size, data.length);
			return {
				params: { ...params, page: pageParam(page) },
				props: {
					...props,
					page: {
						data: data.slice(start, end),
						start,
						end: end - 1,
						size,
						total: data.length,
						currentPage: page,
						lastPage: last,
						url: {
							current: url(page),
							next: page === last ? undefined : url(page + 1),
							prev: page === 1 ? undefined : url(page - 1),
							first: page === 1 ? undefined : url(1),
							last: page === last ? undefined : url(last),
						},
					},
				},
			};
		});
	};
}

/** A route's path for its params, as Astro's route generator writes it. */
function generatedPath(
	{ segments }: RouteShape,
	params: Record<string, unknown>,
	trailingSlash: string,
): string {
	const path = segments
		.map((segment) => {
			const written = segment.map((part) => partOf(part, params)).join("");
			return written === "" ? "" : `/${written}`.replace(/^\/{2,}/, "/");
		})
		.join("");
	const trailing = trailingSlash === "always" && segments.length > 0;
	return `${path}${trailing ? "/" : ""}` || "/";
}

function partOf(
	{ content, dynamic, spread }: RoutePart,
	params: Record<string, unknown>,
): string {
	if (!dynamic) {
		return escaped(content).replace(/%5B/g, "[").replace(/%5D/g, "]");
	}
	const value = params[spread ? content.slice(3) : content];
	if (spread && (value === undefined || value === null)) return "";
	if (value === undefined) throw new TypeError(`Missing parameter: ${content}`);
	return typeof value === "string" ? escaped(value) : String(value);
}

/** A path's text as Astro writes it: in NFC, a `?` and a `#` escaped so they stay in the path. */
function escaped(text: string): string {
	return text.normalize().replace(/\?/g, "%3F").replace(/#/g, "%23");
}

/** A path under the base, as Astro joins the two. */
function withBase(base: string, path: string): string {
	const joined = `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
	return joined === "" ? "/" : joined;
}
