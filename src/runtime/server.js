// The request middleware for servers. The compiler copies this file into the output as it is.
// Client code never imports it: it needs node:async_hooks, which Node, Deno and Bun have, and
// Workers too, by default from compatibility date 2026-08-04, else with the nodejs_als flag.
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
 * calls, so each message called while it runs is in that locale, and while its response's body is
 * read, so a streamed page renders in it too. Returns the handler's response, its `Vary` listing
 * the request headers the strategy reads.
 *
 * @param {Request} request
 * @param {(resolved: { request: Request, locale: string }) => Response | Promise<Response>} handler
 * @returns {Promise<Response>}
 */
export async function middleware(request, handler) {
	const locale = localeOf(request);
	/** @type {import("./runtime.js").RequestLocale} */
	const state = { index: locales.indexOf(locale) };
	const response = await requests.run(state, () =>
		handler({ request, locale }),
	);
	return answer(response, state);
}

/**
 * The handler's response, `vary` appended to its `Vary` and its body read inside the request's
 * binding. It stays the handler's own object where it can: a framework such as Hono keeps that
 * one, and copies its headers onto any response it is given in its place.
 *
 * @param {Response} response
 * @param {import("./runtime.js").RequestLocale} state
 * @returns {Response}
 */
function answer(response, state) {
	const varied = vary === "" || appendVary(response.headers);
	const renders = rendersBody(response);
	if (varied && !renders) return response;
	const copy = new Response(
		renders ? readInRequest(response.body, state) : response.body,
		response,
	);
	if (!varied) copy.headers.append("vary", vary);
	return copy;
}

/**
 * Whether the app's code may render the response's body as it is read. A body from `fetch()` comes
 * from the network, and passing it on as it is keeps the runtime's own pass-through.
 *
 * @param {Response} response
 * @returns {response is Response & { body: ReadableStream<Uint8Array> }}
 */
function rendersBody(response) {
	return response.body !== null && response.url === "";
}

/**
 * The body, read inside the request's binding. The reader's context, not the request's, runs a
 * stream's pull once the middleware has returned, so each read and the cancel run bound. It is
 * read only as the response's body is, so the reader's backpressure reaches the handler's stream,
 * and the stream's error ends the response's body.
 *
 * @param {ReadableStream<Uint8Array>} body
 * @param {import("./runtime.js").RequestLocale} state
 * @returns {ReadableStream<Uint8Array>}
 */
function readInRequest(body, state) {
	const reader = body.getReader();
	return new ReadableStream(
		{
			async pull(controller) {
				const chunk = await requests.run(state, () => reader.read());
				if (chunk.done) controller.close();
				else controller.enqueue(chunk.value);
			},
			cancel: (reason) => requests.run(state, () => reader.cancel(reason)),
		},
		{ highWaterMark: 0 },
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

/** The headers `localeOf` reads: each strategy's but `url`'s, which the config keeps last. */
function headersRead() {
	return strategy
		.filter((source) => source !== "url")
		.map((source) => (source === "cookie" ? "Cookie" : "Accept-Language"));
}

/**
 * Appends `vary` to the headers, unread: a header listed twice means the same to a cache, and
 * reading `Vary` first would cost every request a header read. False when they are immutable, as
 * a response from `fetch()` has them, which no platform lets code ask in advance.
 *
 * @param {Headers} headers
 */
function appendVary(headers) {
	try {
		headers.append("vary", vary);
		return true;
	} catch (error) {
		if (!(error instanceof TypeError)) throw error;
		return false;
	}
}
