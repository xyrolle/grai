// The request middleware for servers. The compiler copies this file into the output as it is.
// Client code never imports it: it needs node:async_hooks, which Node, Deno and Bun have, and
// Workers too, by default from compatibility date 2026-08-04, else with the nodejs_als flag.
import { AsyncLocalStorage } from "node:async_hooks";
import {
	baseLocale,
	cookieName,
	leavesPathsAlone,
	locales,
	prefixesEveryLocale,
	readsUrl,
	strategy,
	unlocalizedPaths,
} from "./config.js";
import {
	assertIsLocale,
	bindRequests,
	localeOfPath,
	localizeUrl,
} from "./runtime.js";

/** @type {AsyncLocalStorage<import("./internal.js").RequestLocale>} */
const requests = new AsyncLocalStorage();
bindRequests(requests);

/** The request headers the strategy reads, which a shared cache must key each response by. */
const vary = headersRead().join(", ");

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
	const locale = localeOf(request, pathname);
	const response = unprefixedPage(request, pathname)
		? Response.redirect(
				localizeUrl(request.url, { locale: assertIsLocale(locale) }),
				307,
			)
		: await requests.run({ index: locales.indexOf(locale) }, () =>
				handler({ request, locale }),
			);
	return vary === "" ? response : withVary(response);
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
		localeOfPath(pathname) === undefined &&
		!(
			leavesPathsAlone &&
			unlocalizedPaths.some((pattern) => pattern.test(pathname))
		)
	);
}

/**
 * The first locale the strategy finds in the request, else the base locale.
 *
 * @param {Request} request
 * @param {string} pathname
 */
function localeOf(request, pathname) {
	for (const source of strategy) {
		const locale =
			source === "cookie"
				? fromCookie(request.headers.get("cookie") ?? "")
				: source === "url"
					? localeOfPath(pathname)
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

/** Each locale lowercased, and its likely form (`en-latn-us` for `en-US`), as ranges reach them. */
const written = locales.map((locale) => locale.toLowerCase());
const likely = locales.map((locale) => likelyTag(locale));
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
 * The locales a range reaches, the nearest first: the range itself, then each parent it is cut down
 * to (`zh-hant-tw`, `zh-hant`, `zh`), as written and then in its likely form (`zh-tw` is
 * `zh-hant-tw`), each matched against a locale as written or in its likely form. A sibling is never
 * reached: `en-au` reaches neither `en-GB` nor `en-US`.
 *
 * @param {string} range
 * @returns {string[]}
 */
function reachedBy(range) {
	const forms = [...parentsOf(range), ...parentsOf(likelyTag(range) ?? range)];
	return forms.flatMap((form) =>
		locales.filter(
			(_, index) => written[index] === form || likely[index] === form,
		),
	);
}

/**
 * A tag and each parent it is cut down to, longest first: `zh-hant-tw`, `zh-hant`, `zh`.
 *
 * @param {string} tag
 */
function parentsOf(tag) {
	const subtags = tag.split("-");
	return subtags.map((_, index) =>
		subtags.slice(0, subtags.length - index).join("-"),
	);
}

/**
 * A tag's likely form, lowercased, from CLDR's likely subtags (`zh-hant-tw` for `zh-TW`), or
 * undefined for a tag the platform cannot read.
 *
 * @param {string} tag
 * @returns {string | undefined}
 */
function likelyTag(tag) {
	try {
		return new Intl.Locale(tag).maximize().toString().toLowerCase();
	} catch (error) {
		if (!(error instanceof RangeError)) throw error;
		return undefined;
	}
}

/** The headers `localeOf` reads: each strategy's but `url`'s, which the config keeps last. */
function headersRead() {
	return strategy
		.filter((source) => source !== "url")
		.map((source) => (source === "cookie" ? "Cookie" : "Accept-Language"));
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
