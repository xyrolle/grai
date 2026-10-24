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
	/** The name of the project's grai config, which errors name. */
	configName: string;
	/** The strategies that read a request beyond its URL: a prerendered page has nothing for them. */
	requestStrategies: readonly string[];
};

/** What the middleware reads of Astro's context. */
export type LocaleContext = Pick<
	APIContext,
	"request" | "isPrerendered" | "routePattern"
>;

/**
 * The middleware `grai/astro` adds before the app's own: it resolves each request's locale by the
 * config's strategy and binds it while the page renders, its islands included. It writes the
 * locale and its text direction to the page's `<html lang>` and `dir`, where the browser's runtime
 * reads the locale. Anything but a page passes through as it is.
 */
export function localeMiddleware(
	project: LocaleProject,
): (
	context: LocaleContext,
	next: () => Promise<Response>,
) => Promise<Response> {
	return (context, next) =>
		project.middleware(context.request, async ({ locale }) => {
			const response = await next();
			const body = documentBody(response);
			if (body === undefined) return response;
			if (context.isPrerendered && project.requestStrategies.length > 0) {
				throw prerendered(project, context.routePattern);
			}
			return withBody(response, body, {
				lang: locale,
				dir: project.getTextDirection(locale),
				head: "",
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

function prerendered(project: LocaleProject, page: string): GraiError {
	const strategies = project.requestStrategies
		.map((strategy) => JSON.stringify(strategy))
		.join(" and ");
	return new GraiError(
		"config-invalid",
		{ file: project.configName },
		`the page ${page} is prerendered, but "strategy" finds the locale in the request (by ${strategies}), which a prerendered page does not have: it would show every reader the one locale it was built in. Render the page on demand (export const prerender = false), or find the locale in the URL alone ("strategy": ["url"]).`,
	);
}
