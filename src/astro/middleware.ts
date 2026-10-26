import type { APIContext } from "astro";
import { GraiError } from "../error.ts";
import { type DocumentStart, rewriteDocumentStart } from "./document.ts";

/**
 * What the middleware takes: `middleware` and `getTextDirection` from the project's compiled
 * output, as methods so that the output's functions, typed with its own locales, fit; and what
 * the integration worked out from the two configs.
 */
export type LocaleProject = {
	/** `middleware` from the output's `server.js`. */
	middleware(
		request: Request,
		handler: (resolved: {
			request: Request;
			locale: string;
		}) => Promise<Response>,
	): Promise<Response>;
	/** `getTextDirection` from the output's `runtime.js`. */
	getTextDirection(locale?: string): "ltr" | "rtl";
	/** `localeOfPath` from the output's `internal.js`: the locale a path names, if it names one. */
	localeOfPath(pathname: string): string | undefined;
	/** `routeOfPath` from the output's `internal.js`: a URL's path in its locale's words as its route. */
	routeOfPath(url: URL): string;
	/** The name of the project's grai config, which errors name. */
	configName: string;
	/**
	 * The strategies that read a request beyond its URL, which a prerendered page has none of: those
	 * before `url`, which a URL's locale gives way to, and those after it, for a path naming none.
	 */
	requestStrategies: {
		beforeUrl: readonly string[];
		afterUrl: readonly string[];
	};
	/**
	 * Each locale's import map, a script that points the shared message chunks at its copies, in a
	 * build; dev serves every locale from one module.
	 */
	importMaps?: Readonly<Record<string, string>> | undefined;
};

/**
 * What the middleware reads of Astro's context. Never its `csp`: Astro warns of every read where
 * the app has no CSP, and the integration lists the import maps' hashes in Astro's config instead.
 */
export type LocaleContext = Pick<
	APIContext,
	"request" | "isPrerendered" | "routePattern"
>;

/**
 * The middleware `grai/astro` adds before the app's own: it resolves each request's locale by the
 * config's strategy and binds it while the page renders, its islands included. It writes the
 * locale and its text direction to the page's `<html lang>` and `dir`, where the browser's runtime
 * reads the locale, and in a build an import map first in the head, so the page's islands load
 * only that locale's copies of the message chunks. Anything but a page passes through as it is.
 */
export function localeMiddleware(
	project: LocaleProject,
): (
	context: LocaleContext,
	next: (rewrite?: string) => Promise<Response>,
) => Promise<Response> {
	return async (context, next) => {
		const url = new URL(context.request.url);
		if (context.isPrerendered) {
			const file = localeAsFile(project, url.pathname);
			if (file !== undefined)
				throw namedAsFile(project, context.routePattern, url.pathname, file);
		}
		// A path in its locale's words renders its route, as Astro routes it by the prefix alone.
		const route = project.routeOfPath(url);
		const render = () =>
			route === url.pathname ? next() : next(route + url.search);
		return project.middleware(context.request, async ({ locale }) => {
			const response = await render();
			const body = documentBody(response);
			if (body === undefined) return response;
			if (context.isPrerendered) {
				const reading = requestRead(project, context.request);
				if (reading.length > 0)
					throw prerendered(project, context.routePattern, reading);
			}
			return withBody(response, body, {
				lang: locale,
				dir: project.getTextDirection(locale),
				head: project.importMaps?.[locale] ?? "",
			});
		});
	};
}

/** The body of a page's response, or undefined for anything else. */
function documentBody(
	response: Response,
): ReadableStream<Uint8Array> | undefined {
	const type = response.headers.get("content-type") ?? "";
	return type.startsWith("text/html")
		? (response.body ?? undefined)
		: undefined;
}

/** The response, its document's start rewritten; the length it had no longer holds. */
function withBody(
	response: Response,
	body: ReadableStream<Uint8Array>,
	start: DocumentStart,
): Response {
	const headers = new Headers(response.headers);
	headers.delete("content-length");
	return new Response(rewriteDocumentStart(body, start), {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

/**
 * A path's first segment when it is a locale's prefix written as a file, such as `ro.html`, which
 * Astro's file builds give a locale's page: read as a folder, `/ro`, the path names another locale.
 */
function localeAsFile(
	{ localeOfPath }: LocaleProject,
	pathname: string,
): string | undefined {
	const first = pathname.split("/")[1] ?? "";
	if (!first.endsWith(".html")) return undefined;
	const asFolder = `/${first.slice(0, -".html".length)}`;
	return localeOfPath(asFolder) === localeOfPath(pathname) ? undefined : first;
}

function namedAsFile(
	project: LocaleProject,
	page: string,
	pathname: string,
	file: string,
): GraiError {
	return new GraiError(
		"config-invalid",
		{ file: project.configName },
		`the page ${page} is prerendered at ${pathname}, which names its locale as a file, ${file}, where the "url" strategy reads a path's first segment. Build each page into a folder: set Astro's build.format to "directory", and name a locale's page [locale]/index.astro rather than [locale].astro.`,
	);
}

/** The strategies a request's locale would be read from beyond its URL, for its path. */
function requestRead(
	{ requestStrategies, localeOfPath }: LocaleProject,
	request: Request,
): readonly string[] {
	const named = localeOfPath(new URL(request.url).pathname) !== undefined;
	return [
		...requestStrategies.beforeUrl,
		...(named ? [] : requestStrategies.afterUrl),
	];
}

function prerendered(
	project: LocaleProject,
	page: string,
	strategies: readonly string[],
): GraiError {
	const by = strategies
		.map((strategy) => JSON.stringify(strategy))
		.join(" and ");
	return new GraiError(
		"config-invalid",
		{ file: project.configName },
		`the page ${page} is prerendered, but "strategy" finds its locale in the request (by ${by}), which a prerendered page does not have: it would show every reader the one locale it was built in. Render the page on demand (export const prerender = false), or have its URL name its locale, with "url" first in "strategy".`,
	);
}
