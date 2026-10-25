// A Worker for workers.test.ts, on the Workers example's compiled output, that streams its body as
// SvelteKit streams a page: its start() pushes four lines, each rendering the title after an await,
// once the middleware has returned. It reads nothing but the request, so any runtime that serves a
// Worker's module runs it.
import { m } from "../examples/workers/src/i18n/messages.js";
import { middleware } from "../examples/workers/src/i18n/server.js";

const LINES = 4;
const encoder = new TextEncoder();
/** A turn of the event loop: what comes after it runs once the middleware has returned. */
const later = () => new Promise((resolve) => setTimeout(resolve, 0));

export default {
	/** @param {Request} request */
	fetch: (request) =>
		middleware(request, () => {
			const page = new ReadableStream({
				/** @param {ReadableStreamDefaultController<Uint8Array>} controller */
				async start(controller) {
					for (let line = 0; line < LINES; line++) {
						await later();
						controller.enqueue(encoder.encode(`${m.title()}\n`));
					}
					controller.close();
				},
			});
			return new Response(page, {
				headers: { "content-type": "text/plain; charset=utf-8" },
			});
		}),
};
