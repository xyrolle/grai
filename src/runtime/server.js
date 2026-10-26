// The request middleware for servers. The compiler copies this file into the output as it is.
// Client code never imports it: it needs node:async_hooks, which Node, Deno and Bun have, and
// Workers too, by default from compatibility date 2026-08-04, else with the nodejs_als flag.
import { AsyncLocalStorage } from "node:async_hooks";
import {
	baseLocale,
	cookieName,
	locales,
	prefixesEveryLocale,
	queryParameter,
	readsUrl,
	strategy,
} from "./config.js";
import {
	assertIsLocale,
	bindRequests,
	isLocale,
	lacksPrefix,
	localeOfPath,
	localizeUrl,
} from "./runtime.js";

// Whether the build wrote a copy of each message chunk per locale, for an adapter that points a
// page at its locale's copies only when they exist.
export { localeCopies } from "./config.js";

/** @type {AsyncLocalStorage<import("./runtime.js").RequestLocale>} */
const requests = new AsyncLocalStorage();
bindRequests(requests);

/**
 * The request headers the strategy reads, which a shared cache must key each response by: the
 * `Vary` the middleware adds, for a framework that sends its response apart from the middleware.
 */
export const vary = headersRead().join(", ");

/**
 * Resolves the request's locale by the config's strategy and binds it for the handler and all it
 * calls, so each message called while it runs is in that locale. Returns the handler's response,
 * its `Vary` listing the request headers the strategy reads. With every locale's paths prefixed, a
 * page asked for without a prefix is sent to its locale's path instead.
 *
 * @param {Request} request
 * @param {(resolved: { request: Request, locale: string }) => Response | Promise<Response>} handler
 * @returns {Promise<Response>}
 */
export async function middleware(request, handler) {
	const { pathname } = new URL(request.url);
	const locale = assertIsLocale(findLocale(request, pathname));
	const response = unprefixedPage(request, pathname)
		? Response.redirect(localizeUrl(request.url, { locale }), 307)
		: await requests.run({ index: locales.indexOf(locale) }, () =>
				handler({ request, locale }),
			);
	return vary === "" ? response : withVary(response);
}

/**
 * The locale the middleware binds for a request: the first the strategy finds in it, else the base
 * locale. For a framework that renders apart from the middleware.
 *
 * @param {Request} request
 * @returns {string}
 */
export function localeOf(request) {
	return assertIsLocale(findLocale(request, new URL(request.url).pathname));
}

/**
 * The redirect the middleware answers a request with, its `Vary` included, else undefined: with
 * every locale's paths prefixed, a page asked for without a prefix is sent to its locale's path.
 * For a framework that renders apart from the middleware.
 *
 * @param {Request} request
 * @returns {Response | undefined}
 */
export function redirectOf(request) {
	const { pathname } = new URL(request.url);
	if (!unprefixedPage(request, pathname)) return undefined;
	const locale = assertIsLocale(findLocale(request, pathname));
	const redirect = Response.redirect(localizeUrl(request.url, { locale }), 307);
	return vary === "" ? redirect : withVary(redirect);
}

/**
 * Whether the request asks for a page at a path without a locale prefix, which with every
 * locale's paths prefixed is not a page's own: a GET or a HEAD, as a form's POST must not be
 * answered with another address, at a path the `url` strategy does not leave alone.
 *
 * @param {Request} request
 * @param {string} pathname
 */
function unprefixedPage(request, pathname) {
	return (
		prefixesEveryLocale &&
		readsUrl &&
		(request.method === "GET" || request.method === "HEAD") &&
		lacksPrefix(pathname)
	);
}

/**
 * The first locale the strategy finds in the request, else the base locale.
 *
 * @param {Request} request
 * @param {string} pathname
 */
function findLocale(request, pathname) {
	for (const source of strategy) {
		const locale = fromSource(source, request, pathname);
		if (locale !== undefined) return locale;
	}
	return baseLocale;
}

/**
 * The locale one place of the strategy names in the request. `localStorage` is the page's alone,
 * and a request does not carry it.
 *
 * @param {(typeof strategy)[number]} source
 * @param {Request} request
 * @param {string} pathname
 * @returns {string | undefined}
 */
function fromSource(source, request, pathname) {
	switch (source) {
		case "cookie":
			return fromCookie(request.headers.get("cookie") ?? "");
		case "preferredLanguage":
			return fromAcceptLanguage(request.headers.get("accept-language") ?? "");
		case "query":
			return fromQuery(request.url);
		case "url":
			return localeOfPath(pathname);
		case "localStorage":
			return undefined;
	}
}

/**
 * The locale the URL's query parameter names, matched as a preferred language is, since a link may
 * name `de-AT` where the project has `de`.
 *
 * @param {string} url
 */
function fromQuery(url) {
	const tag =
		queryParameter === undefined
			? null
			: new URL(url).searchParams.get(queryParameter);
	return tag === null ? undefined : reachedBy(tag)[0];
}

/** @param {string} header */
function fromCookie(header) {
	for (const cookie of header.split(";")) {
		const [name, value] = cookie.split("=").map((part) => part.trim());
		if (name === cookieName && isLocale(value)) {
			return value;
		}
	}
	return undefined;
}

/** The locales a language range reaches, the nearest first. */
const reachedBy = localeReach(locales);
/** The locales the base locale first, as `*` takes them. */
const baseFirst = [
	baseLocale,
	...locales.filter((locale) => locale !== baseLocale),
];
/** A language range as RFC 4647 writes one: `*`, or a language and subtags of up to 8 letters or digits. */
const languageRange = /^(?:\*|[a-z]{1,8}(?:-[a-z0-9]{1,8})*)$/;
/** A weight as RFC 9110 writes one: 0 to 1, with at most three decimals. */
const qvalue = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/;

/**
 * Each Accept-Language header read so far, with the locale it gives. Browsers send few distinct
 * headers, and a range's likely form costs about 3 µs to work out, so each header is read once.
 * The headers come from outside, so the map is emptied once it holds `headersKept`.
 *
 * @type {Map<string, string | undefined>}
 */
const negotiated = new Map();
const headersKept = 1024;

/** @param {string} header */
function fromAcceptLanguage(header) {
	if (negotiated.has(header)) return negotiated.get(header);
	if (negotiated.size >= headersKept) negotiated.clear();
	const locale = preferredLocale(header);
	negotiated.set(header, locale);
	return locale;
}

/**
 * The locale the request prefers most: its ranges by weight, each taking the first locale it
 * reaches that no range refuses with `q=0`. `*` reaches every locale no other range names, the
 * base locale first.
 *
 * @param {string} header
 * @returns {string | undefined}
 */
function preferredLocale(header) {
	const ranges = languageRanges(header);
	const named = ranges.filter(({ range }) => range !== "*");
	const refused = named.filter(({ weight }) => weight === 0);
	const acceptable = (/** @type {string} */ locale) =>
		!refused.some(({ range }) => covers(range, locale));
	for (const { range, weight } of ranges) {
		if (weight === 0) continue;
		const reached =
			range === "*"
				? baseFirst.filter(
						(locale) => !named.some((other) => covers(other.range, locale)),
					)
				: reachedBy(range);
		const locale = reached.find(acceptable);
		if (locale !== undefined) return locale;
	}
	return undefined;
}

/**
 * The header's language ranges, lowercased, with their weights, the heaviest first. An entry whose
 * range or weight is malformed is left out, as a client could not have meant it.
 *
 * @param {string} header
 */
function languageRanges(header) {
	/** @type {{ range: string, weight: number }[]} */
	const ranges = [];
	for (const entry of header.split(",")) {
		const [range = "", ...parameters] = entry
			.split(";")
			.map((part) => part.trim());
		const q = parameters.find((parameter) => /^q=/i.test(parameter))?.slice(2);
		const lowered = range.toLowerCase();
		if (!languageRange.test(lowered) || (q !== undefined && !qvalue.test(q))) {
			continue;
		}
		ranges.push({ range: lowered, weight: q === undefined ? 1 : Number(q) });
	}
	return ranges.sort((a, b) => b.weight - a.weight);
}

/**
 * Whether a range names a locale, as RFC 4647's basic filtering has it: the locale is the range, or
 * begins with it and a hyphen.
 *
 * @param {string} range
 * @param {string} locale
 */
function covers(range, locale) {
	const tag = locale.toLowerCase();
	return tag === range || tag.startsWith(`${range}-`);
}

/**
 * The headers `findLocale` reads, in the strategy's order: `query` and `url` read the URL, which a
 * cache keys on already, and a request does not carry `localStorage`.
 */
function headersRead() {
	/** @type {Record<(typeof strategy)[number], string[]>} */
	const headersOf = {
		cookie: ["Cookie"],
		localStorage: [],
		preferredLanguage: ["Accept-Language"],
		query: [],
		url: [],
	};
	return strategy.flatMap((source) => headersOf[source]);
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

/**
 * How language ranges reach the project's locales: for a range, the locales it reaches, the
 * nearest first. A range reaches itself, then each parent it is cut down to (`zh-hant-tw`,
 * `zh-hant`, `zh`), as written and then in its likely form from CLDR's likely subtags (`zh-tw` is
 * `zh-hant-tw`), each matched against a locale as written or in its likely form. A sibling is never
 * reached: `en-au` reaches neither `en-GB` nor `en-US`.
 *
 * A page's locale script matches the browser's languages with this same function, whose source
 * grai/vite writes into the script (`locale-script.ts`), so it refers to nothing outside its body.
 *
 * @param {readonly string[]} locales
 * @returns {(range: string) => string[]}
 */
function localeReach(locales) {
	/** @param {string} tag a tag, lowercased, and each parent it is cut down to, longest first */
	const parentsOf = (tag) => {
		const subtags = tag.split("-");
		return subtags.map((_, index) =>
			subtags.slice(0, subtags.length - index).join("-"),
		);
	};
	/** @param {string} tag its likely form, lowercased, or undefined for one Intl cannot read */
	const likelyTag = (tag) => {
		try {
			return new Intl.Locale(tag).maximize().toString().toLowerCase();
		} catch (error) {
			if (!(error instanceof RangeError)) throw error;
			return undefined;
		}
	};
	const written = locales.map((locale) => locale.toLowerCase());
	const likely = locales.map(likelyTag);
	return (range) => {
		const lowered = range.toLowerCase();
		const forms = [
			...parentsOf(lowered),
			...parentsOf(likelyTag(lowered) ?? lowered),
		];
		return forms.flatMap((form) =>
			locales.filter(
				(_, index) => written[index] === form || likely[index] === form,
			),
		);
	};
}
