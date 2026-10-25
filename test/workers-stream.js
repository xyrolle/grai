// A Worker for workers.test.ts, on the Workers example's compiled output, that streams its body as
// a server-rendered page does: four lines, each rendering the title when the runtime pulls it,
// after the middleware has returned. Its pulls are synchronous, so the runtime's reads start them.
// It reads nothing but the request, so any runtime that serves a Worker's module runs it.
import { m } from "../examples/workers/src/i18n/messages.js";
import { middleware } from "../examples/workers/src/i18n/server.js";

const LINES = 4;
const encoder = new TextEncoder();

export default {
	/** @param {Request} request */
	fetch: (request) =>
		middleware(request, () => {
			let sent = 0;
			const page = new ReadableStream({
				/** @param {ReadableStreamDefaultController<Uint8Array>} controller */
				pull(controller) {
					controller.enqueue(encoder.encode(`${m.title()}\n`));
					if (++sent === LINES) controller.close();
				},
			});
			return new Response(page, {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}),
};
