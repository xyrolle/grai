import type { APIContext } from "astro";
import { GraiError } from "../error.ts";
import { type DocumentStart, rewriteDocumentStart } from "./document.ts";

/** A page's import map to its locale's copies of the message chunks, and its hash for a CSP. */
export type ImportMap = { script: string; hash: `sha256-${string}` };

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
	/** `localeOfPath` from the output's `runtime.js`: the locale a path names, if it names one. */
	localeOfPath(pathname: string): string | undefined;
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
	/** Each locale's import map, in a build; dev serves every locale from one module. */
	importMaps?: Readonly<Record<string, ImportMap>> | undefined;
};

/** What the middleware reads of Astro's context. */
export type LocaleContext = Pick<
	APIContext,
	"request" | "isPrerendered" | "routePattern"
> & {
	csp: Pick<NonNullable<APIContext["csp"]>, "insertScriptHash"> | undefined;
};

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
	next: () => Promise<Response>,
) => Promise<Response> {
	return (context, next) =>
		project.middleware(context.request, async ({ locale }) => {
			const importMap = project.importMaps?.[locale];
			if (importMap !== undefined)
				context.csp?.insertScriptHash(importMap.hash);
			const response = await next();
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
				head: importMap?.script ?? "",
			});
		});
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
