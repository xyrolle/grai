// A Worker for workers.test.ts, on the Workers example's compiled output. Each request renders a
// message, switches its locale if its URL says `switchTo=<locale>`, waits until as many requests
// as its URL names (`requests=30`) have rendered theirs, then renders it again: every second
// render runs while the other requests are bound to their own locales. It reads nothing but the
// request, so any runtime that serves a Worker's module runs it.
import { m } from "../examples/workers/src/i18n/messages.js";
import { getLocale, setLocale } from "../examples/workers/src/i18n/runtime.js";
import { middleware } from "../examples/workers/src/i18n/server.js";

/** @type {(() => void)[]} */
const waiting = [];

/**
 * Settles once `count` requests wait, then waits for the next `count`. Each request waits on a
 * promise of its own: one made outside any request would resume every waiter in the request that
 * settles it, and workerd lets no request answer with another's response body.
 *
 * @param {number} count
 * @returns {Promise<void>}
 */
function allWaiting(count) {
	return new Promise((resolve) => {
		waiting.push(resolve);
		if (waiting.length === count) {
			for (const release of waiting.splice(0)) release();
		}
	});
}

export default {
	/** @param {Request} request */
	fetch: (request) =>
		middleware(request, async ({ locale }) => {
			const first = m.title();
			const url = new URL(request.url);
			const switchTo = url.searchParams.get("switchTo");
			if (switchTo !== null) setLocale(switchTo);
			await allWaiting(Number(url.searchParams.get("requests")));
			return Response.json({
				locale,
				bound: getLocale(),
				renders: [first, m.title()],
			});
		}),
};
