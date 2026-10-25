// What a request pays for its locale: the time grai's middleware and Paraglide's add to a handler
// alone, each resolving the locale from the same request by the same strategy and binding it, and
// grai's listing the headers it read in Vary and reading the body in the request's binding, each
// response's body read to its end; and a message call inside a request and outside any.
// middleware.mjs runs this in Node, and middleware-worker.js inside workerd, on the projects it
// compiles from the Workers example's catalogs: one reading the cookie, then Accept-Language, and
// one reading the URL.
import { m } from "./.cache/middleware/headers/out/messages.js";
import { middleware as byHeaders } from "./.cache/middleware/headers/out/server.js";
import { paraglideMiddleware as paraglideByHeaders } from "./.cache/middleware/paraglide-headers/out/server.js";
import { paraglideMiddleware as paraglideByUrl } from "./.cache/middleware/paraglide-url/out/server.js";
import { middleware as byUrl } from "./.cache/middleware/url/out/server.js";
import { nanosecondsPer } from "./measure.mjs";

const ROUNDS = 11;
/** At least this long a round: workerd's clock moves in whole milliseconds. */
const ROUND_MS = 200;
const CALLS = 100;

/** A browser's own headers: a few cookies, and its languages by preference. */
const browser = {
	cookie: "_ga=GA1.1.1975364802.1792859100; theme=dark",
	"accept-language": "ro-RO,ro;q=0.9,en-US;q=0.8,en;q=0.7",
};
const byCookie = new Request("https://bench.test/cart", {
	headers: { ...browser, cookie: `${browser.cookie}; lang=ro` },
});

/** Each kind of request, all in `ro`, and the middleware of each library that reads it. */
const requests = [
	{
		name: "cookie",
		grai: byHeaders,
		paraglide: paraglideByHeaders,
		request: byCookie,
	},
	{
		name: "Accept-Language, no locale cookie",
		grai: byHeaders,
		paraglide: paraglideByHeaders,
		request: new Request("https://bench.test/cart", { headers: browser }),
	},
	{
		name: "URL prefix",
		grai: byUrl,
		paraglide: paraglideByUrl,
		request: new Request("https://bench.test/ro/cart", { headers: browser }),
	},
];

/** The handler every request runs, alone and through each middleware. */
const handler = () => new Response("Coșul tău");

/** The body of `response`, read to its end, as the server that sends it does. */
const read = async (/** @type {Response | Promise<Response>} */ response) =>
	(await response).arrayBuffer();

/**
 * Nanoseconds per request of `serve`, over `count` requests awaited one after another, then a turn
 * of the event loop: what the requests leave to it, such as the finalizers of Paraglide's copies of
 * each request, runs before the next round, or memory grows until the process dies.
 */
async function nanosecondsPerRequest(serve, count) {
	const start = performance.now();
	for (let i = 0; i < count; i++) await serve();
	const nanoseconds = ((performance.now() - start) * 1e6) / count;
	await new Promise((resolve) => setTimeout(resolve, 0));
	return nanoseconds;
}

/** How many requests of `serve` fill a round. Doubling the count up to it warms the engine up too. */
async function requestsPerRound(serve) {
	let count = 1000;
	while ((await nanosecondsPerRequest(serve, count)) * count < ROUND_MS * 1e6)
		count *= 2;
	return count;
}

/**
 * The median time per request of `alone`, and what each of `serves` adds to it. They take turns
 * round by round, so a load that comes and goes reaches them alike.
 */
async function timeAgainst(alone, serves) {
	const all = [alone, ...serves];
	const counts = [];
	for (const serve of all) counts.push(await requestsPerRound(serve));
	const rounds = [];
	for (let r = 0; r < ROUNDS; r++) {
		const round = [];
		for (const [i, serve] of all.entries())
			round.push(await nanosecondsPerRequest(serve, counts[i]));
		rounds.push(round);
	}
	const added = (i) => median(rounds.map((round) => round[i] - round[0]));
	return [
		median(rounds.map((round) => round[0])),
		...serves.map((_, i) => added(i + 1)),
	];
}

function median(values) {
	return values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
}

/** Each kind of request's time by the handler alone, and what each middleware adds to it. */
async function timeRequests() {
	const timings = [];
	for (const { name, grai, paraglide, request } of requests) {
		for (const middleware of [grai, paraglide]) {
			const resolved = await (
				await middleware(request, ({ locale }) => new Response(locale))
			).text();
			if (resolved !== "ro")
				throw new Error(`${name}: a middleware resolved ${resolved}, not ro`);
		}
		const [alone, byGrai, byParaglide] = await timeAgainst(
			() => read(handler()),
			[
				() => read(grai(request, handler)),
				() => read(paraglide(request, handler)),
			],
		);
		timings.push({ name, alone, grai: byGrai, paraglide: byParaglide });
	}
	return timings;
}

/** A text message's and a message with inputs' median time per call. */
function timeCalls() {
	const inputs = { name: "Workers" };
	const calls = (call) => () => {
		let rendered = "";
		for (let i = 0; i < CALLS; i++) rendered += call();
		return rendered;
	};
	const options = { roundMs: ROUND_MS, rounds: ROUNDS };
	return {
		text: nanosecondsPer(
			calls(() => m.title()),
			CALLS,
			options,
		),
		inputs: nanosecondsPer(
			calls(() => m.greeting(inputs)),
			CALLS,
			options,
		),
	};
}

/** Both tables' timings: the calls inside a request in `ro`, and outside any in the base locale. */
export async function timeServer() {
	let inside;
	await byHeaders(byCookie, () => {
		inside = timeCalls();
		return new Response("");
	});
	return {
		requests: await timeRequests(),
		calls: { inside, outside: timeCalls() },
	};
}
