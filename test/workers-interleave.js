// A Worker for workers.test.ts, on the Workers example's compiled output. Its one request runs 30
// requests through the middleware at once, ten in each locale: each renders a message, waits until
// all 30 have, and renders it again, so every second render runs while the other requests are
// bound to their own locales. With `?switch=<from>:<to>`, the requests in `from` call setLocale to
// `to` before they wait. They interleave inside one request because no request may wait on another:
// workerd cancels one that has nothing of its own left to run, and Bun closes one after 10 seconds.
// It reads nothing but the request, so any runtime that serves a Worker's module runs it.
import { m } from "../examples/workers/src/i18n/messages.js";
import {
	getLocale,
	locales,
	setLocale,
} from "../examples/workers/src/i18n/runtime.js";
import { middleware } from "../examples/workers/src/i18n/server.js";

/** 30 requests, ten in each locale, in turn. */
const sent = Array.from({ length: 10 }, () => locales).flat();

export default {
	/** @param {Request} request */
	fetch: async (request) => {
		const [from, to] = (
			new URL(request.url).searchParams.get("switch") ?? ""
		).split(":");
		const allRendered = barrier(sent.length);
		const answers = sent.map(async (locale) => {
			const answered = await middleware(
				new Request("https://interleave.test/", {
					headers: { cookie: `lang=${locale}` },
				}),
				async () => {
					const first = m.title();
					if (locale === from && to !== undefined) setLocale(to);
					await allRendered();
					return Response.json({
						locale,
						bound: getLocale(),
						renders: [first, m.title()],
					});
				},
			);
			return answered.json();
		});
		return Response.json(await Promise.all(answers));
	},
};

/**
 * A wait for `count` callers: the promise each one gets settles once the last one has called.
 *
 * @param {number} count
 * @returns {() => Promise<void>}
 */
function barrier(count) {
	/** @type {() => void} */
	let release = () => {};
	/** @type {Promise<void>} */
	const released = new Promise((resolve) => {
		release = resolve;
	});
	let arrived = 0;
	return () => {
		if (++arrived === count) release();
		return released;
	};
}
