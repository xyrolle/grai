// The request middleware for servers. The compiler copies this file into the output as it is.
// Client code never imports it: it needs node:async_hooks, which Node, Deno, Bun and Workers with
// nodejs_compat have.
import { AsyncLocalStorage } from "node:async_hooks";
import { baseLocale, cookieName, locales, strategy } from "./config.js";
import { bindRequests, extractLocaleFromUrl } from "./runtime.js";

/** @type {AsyncLocalStorage<import("./runtime.js").RequestLocale>} */
const requests = new AsyncLocalStorage();
bindRequests(requests);

/** The request headers the strategy reads, which a shared cache must key each response by. */
const vary = headersRead().join(", ");

/**
 * Resolves the request's locale by the config's strategy and binds it for the handler and all it
 * calls, so each message called while it runs is in that locale. Returns the handler's response,
 * its `Vary` listing the request headers the strategy reads.
 *
 * @param {Request} request
 * @param {(resolved: { request: Request, locale: string }) => Response | Promise<Response>} handler
 * @returns {Promise<Response>}
 */
export async function middleware(request, handler) {
	const locale = localeOf(request);
	const response = await requests.run({ index: locales.indexOf(locale) }, () =>
		handler({ request, locale }),
	);
	return vary === "" ? response : withVary(response);
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

/** The headers `localeOf` reads: each strategy's, up to `url`, which always finds a locale. */
function headersRead() {
	/** @type {string[]} */
	const headers = [];
	for (const source of strategy) {
		if (source === "url") break;
		headers.push(source === "cookie" ? "Cookie" : "Accept-Language");
	}
	return headers;
}

/**
 * The response with `vary` appended to its `Vary`, unread: a header listed twice means the same to
 * a cache, and reading `Vary` first would cost every request a header read. A response from
 * `fetch()` has immutable headers, and the platform has no way to ask, so such a response is
 * copied, its body unread.
 *
 * @param {Response} response
 */
function withVary(response) {
	try {
		response.headers.append("vary", vary);
		return response;
	} catch (error) {
		if (!(error instanceof TypeError)) throw error;
		const copy = new Response(response.body, response);
		copy.headers.append("vary", vary);
		return copy;
	}
}
