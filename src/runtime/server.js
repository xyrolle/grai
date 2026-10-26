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
	GraiError,
	isLocale,
	lacksPrefix,
	localeOfHost,
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
 * Runs `code` in `locale` as the middleware runs a request's handler: each message it calls, and
 * each task it starts, renders in that locale. A server renders nothing outside a request, so a
 * job, such as a scheduled email, runs its code in this, and so does a test: under Vitest,
 * `aroundEach((test) => withLocale("de", test))`.
 *
 * @template Result
 * @param {string} locale
 * @param {() => Result} code
 * @returns {Result}
 */
export function withLocale(locale, code) {
	return requests.run({ index: locales.indexOf(assertIsLocale(locale)) }, code);
}

/**
 * A strategy the server defines: how it finds a request's locale, if the request names one, and
 * the request headers it reads, for the `Vary` the middleware adds. Without them, any header may
 * change the locale, so the response varies by every one: `*`.
 *
 * @typedef {{
 *   getLocale(request: Request): string | undefined | Promise<string | undefined>,
 *   vary?: readonly string[],
 * }} ServerStrategy
 */

/** @type {Map<string, ServerStrategy>} */
const defined = new Map();

/**
 * The request headers the strategy reads, which a shared cache must key each response by: the
 * `Vary` the middleware adds, for a framework that sends its response apart from the middleware.
 * A definition of the server's own strategy names the ones it reads.
 */
export let vary = headersRead().join(", ");

/**
 * Defines one of the server's own strategies, which the config's `strategy` lists by its name, such
 * as `custom-session`: the middleware asks it for a request's locale in the strategy's order, and
 * goes on to the next where it names none. A page does not read it. Define each before the first
 * request.
 *
 * @param {string} name
 * @param {ServerStrategy} serverStrategy
 */
export function defineServerStrategy(name, serverStrategy) {
	if (
		!name.startsWith("custom-") ||
		!strategy.some((source) => source === name)
	) {
		throw new GraiError(
			"strategy-undefined",
			`"${name}" is not in the config's "strategy": ${JSON.stringify(strategy)}. Name the strategy there, then define it.`,
		);
	}
	defined.set(name, serverStrategy);
	vary = headersRead().join(", ");
}

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
	const url = new URL(request.url);
	const found = findLocale(request, url);
	// Awaited only where the server's own strategy was asked, so no other request waits a turn.
	const locale = assertIsLocale(
		typeof found === "string" ? found : await found,
	);
	const response = unprefixedPage(request, url)
		? Response.redirect(localizeUrl(url, { locale }), 307)
		: await requests.run({ index: locales.indexOf(locale), url }, () =>
				handler({ request, locale }),
			);
	return vary === "" ? response : withVary(response);
}

/**
 * The locale the middleware binds for a request: the first the strategy finds in it, else the base
 * locale. For a framework that renders apart from the middleware.
 *
 * @param {Request} request
 * @returns {Promise<string>}
 */
export async function localeOf(request) {
	return assertIsLocale(await findLocale(request, new URL(request.url)));
}

/**
 * The redirect the middleware answers a request with, its `Vary` included, else undefined: with
 * every locale's paths prefixed, a page asked for without a prefix is sent to its locale's path.
 * For a framework that renders apart from the middleware.
 *
 * @param {Request} request
 * @returns {Promise<Response | undefined>}
 */
export async function redirectOf(request) {
	const url = new URL(request.url);
	if (!unprefixedPage(request, url)) return undefined;
	const locale = assertIsLocale(await findLocale(request, url));
	const redirect = Response.redirect(localizeUrl(url, { locale }), 307);
	return vary === "" ? redirect : withVary(redirect);
}

/**
 * Whether the request asks for a page at a path without a locale prefix, which with every
 * locale's paths prefixed is not a page's own: a GET or a HEAD, as a form's POST must not be
 * answered with another address, at a path the `url` strategy does not leave alone.
 *
 * @param {Request} request
 * @param {URL} url
 */
function unprefixedPage(request, url) {
	return (
		prefixesEveryLocale &&
		readsUrl &&
		(request.method === "GET" || request.method === "HEAD") &&
		localeOfHost(url.host) === undefined &&
		lacksPrefix(url.pathname)
	);
}

/**
 * The first locale the strategy finds in the request, else the base locale.
 *
 * @param {Request} request
 * @param {URL} url
 * @param {number} [from] the place in the strategy to start at
 * @returns {string | Promise<string>}
 */
function findLocale(request, url, from = 0) {
	for (let index = from; index < strategy.length; index++) {
		const source = strategy[index];
		if (source === undefined) break;
		if (source.startsWith("custom-")) {
			// The server's own strategy may wait on a session, and the places after it wait for it.
			return fromServer(source, request).then(
				(locale) => locale ?? findLocale(request, url, index + 1),
			);
		}
		const locale = fromSource(source, request, url);
		if (locale !== undefined) return locale;
	}
	return baseLocale;
}

/**
 * The locale one of the server's own strategies finds in the request, if it finds one, which must
 * be one of the project's.
 *
 * @param {string} name
 * @param {Request} request
 * @returns {Promise<string | undefined>}
 */
async function fromServer(name, request) {
	const serverStrategy = defined.get(name);
	if (serverStrategy === undefined) {
		throw new GraiError(
			"strategy-undefined",
			`"strategy" lists "${name}", which no defineServerStrategy("${name}", { getLocale }) on this server defines. Define it before the first request.`,
		);
	}
	const locale = await serverStrategy.getLocale(request);
	return locale === undefined ? undefined : assertIsLocale(locale);
}

/**
 * The locale one place of the strategy names in the request. `localStorage` is the page's alone,
 * and a request does not carry it.
 *
 * @param {(typeof strategy)[number]} source
 * @param {Request} request
 * @param {URL} url
 * @returns {string | undefined}
 */
function fromSource(source, request, url) {
	switch (source) {
		case "cookie":
			return fromCookie(request.headers.get("cookie") ?? "");
		case "preferredLanguage":
			return fromAcceptLanguage(request.headers.get("accept-language") ?? "");
		case "query":
			return fromQuery(url);
		case "url":
			return localeOfHost(url.host) ?? localeOfPath(url.pathname);
		// localStorage is the page's alone, and the server's own strategies are read by findLocale.
		default:
			return undefined;
	}
}

/**
 * The locale the URL's query parameter names, matched as a preferred language is, since a link may
 * name `de-AT` where the project has `de`.
 *
 * @param {URL} url
 */
function fromQuery(url) {
	const tag =
		queryParameter === undefined ? null : url.searchParams.get(queryParameter);
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
	/** @type {Record<string, readonly string[]>} */
	const headersOf = {
		cookie: ["Cookie"],
		localStorage: [],
		preferredLanguage: ["Accept-Language"],
		query: [],
		url: [],
	};
	return strategy.flatMap(
		(source) => headersOf[source] ?? defined.get(source)?.vary ?? ["*"],
	);
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
