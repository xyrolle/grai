// The request middleware for servers. The compiler copies this file into the output as it is.
// Client code never imports it: it needs node:async_hooks, which Node, Deno, Bun and Workers with
// nodejs_compat have.
import { AsyncLocalStorage } from "node:async_hooks";
import { baseLocale, cookieName, locales, strategy } from "./config.js";
import { bindRequests, extractLocaleFromUrl } from "./runtime.js";

/** @type {AsyncLocalStorage<number>} */
const requests = new AsyncLocalStorage();
bindRequests(requests);

/**
 * Resolves the request's locale by the config's strategy and binds it for the handler and all it
 * calls, so each message called while it runs is in that locale. Returns what the handler returns.
 *
 * @template Result
 * @param {Request} request
 * @param {(resolved: { request: Request, locale: string }) => Result} handler
 * @returns {Result}
 */
export function middleware(request, handler) {
	const locale = localeOf(request);
	return requests.run(locales.indexOf(locale), () =>
		handler({ request, locale }),
	);
}

/** The first locale the strategy finds in the request, else the base locale. */
function localeOf(/** @type {Request} */ request) {
	for (const source of strategy) {
		const locale =
			source === "cookie"
				? fromCookie(request.headers.get("cookie") ?? "")
				: source === "url"
					? extractLocaleFromUrl(request.url)
					: fromAcceptLanguage(request.headers.get("accept-language") ?? "");
		if (locale !== undefined) return locale;
	}
	return baseLocale;
}

/** @param {string} header */
function fromCookie(header) {
	for (const cookie of header.split(";")) {
		const [name, value] = cookie.split("=").map((part) => part.trim());
		if (name === cookieName && value !== undefined && locales.includes(value)) {
			return value;
		}
	}
	return undefined;
}

/**
 * The locale the request prefers most: its tags by their q weights, each matched exactly, then by
 * its language.
 *
 * @param {string} header
 */
function fromAcceptLanguage(header) {
	const tags = header
		.split(",")
		.map((entry) => {
			const [tag = "", ...parameters] = entry
				.split(";")
				.map((part) => part.trim());
			const q = parameters.find((parameter) => parameter.startsWith("q="));
			return {
				tag: tag.toLowerCase(),
				weight: q === undefined ? 1 : Number(q.slice(2)),
			};
		})
		.filter(({ tag, weight }) => tag !== "" && tag !== "*" && weight > 0)
		.sort((a, b) => b.weight - a.weight);
	for (const { tag } of tags) {
		const language = tag.split("-")[0];
		const locale =
			locales.find((candidate) => candidate.toLowerCase() === tag) ??
			locales.find(
				(candidate) => candidate.toLowerCase().split("-")[0] === language,
			);
		if (locale !== undefined) return locale;
	}
	return undefined;
}
