import { describe, expect, it } from "vitest";
import {
	type DocumentStart,
	rewriteDocumentStart,
} from "../src/astro/document.ts";

const start: DocumentStart = {
	lang: "ar",
	dir: "rtl",
	head: '<script type="importmap">{}</script>',
};

/** A body streamed in the given chunks, rewritten, as a response to read it back whole. */
function rewrittenBody(chunks: readonly (string | Uint8Array)[]): Response {
	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			for (const chunk of chunks) {
				controller.enqueue(
					typeof chunk === "string" ? encoder.encode(chunk) : chunk,
				);
			}
			controller.close();
		},
	});
	return new Response(rewriteDocumentStart(body, start));
}

const rewritten = (chunks: readonly (string | Uint8Array)[]) =>
	rewrittenBody(chunks).text();

describe("the document's start", () => {
	it("gets the page's lang and dir, keeps the tag's other attributes, and opens the head with the given script", async () => {
		const page = `<!DOCTYPE html><html class="dark" LANG="en" data-note='a > b' dir=ltr hidden><head><meta charset="utf-8"></head><body>Hi</body></html>`;

		expect(await rewritten([page])).toBe(
			`<!DOCTYPE html><html class="dark" data-note='a > b' hidden lang="ar" dir="rtl"><head><script type="importmap">{}</script><meta charset="utf-8"></head><body>Hi</body></html>`,
		);
	});

	it("reads a start cut anywhere, a character of several bytes included", async () => {
		const page = `<!DOCTYPE html>\n<!-- a page -->\n<html data-title="Bună ziua" lang="ro">\n<head>\n<title>Bună</title></head></html>`;
		const bytes = new TextEncoder().encode(page);
		const oneByOne = Array.from(bytes, (byte) => Uint8Array.of(byte));

		expect(await rewritten(oneByOne)).toBe(await rewritten([page]));
		expect(await rewritten([page])).toBe(
			`<!DOCTYPE html>\n<!-- a page -->\n<html data-title="Bună ziua" lang="ar" dir="rtl">\n<head><script type="importmap">{}</script>\n<title>Bună</title></head></html>`,
		);
	});

	it("passes on what follows the start as it comes, before the page has ended", async () => {
		const encoder = new TextEncoder();
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		const body = new ReadableStream<Uint8Array>({
			start(opened) {
				controller = opened;
			},
		});
		const reader = rewriteDocumentStart(body, start).getReader();
		const decoder = new TextDecoder();

		controller?.enqueue(encoder.encode("<!doctype html><html><head><title>"));
		const first = await reader.read();
		controller?.enqueue(encoder.encode("Shop</title>"));
		const second = await reader.read();

		expect(decoder.decode(first.value)).toBe(
			`<!doctype html><html lang="ar" dir="rtl"><head><script type="importmap">{}</script>`,
		);
		expect(decoder.decode(second.value)).toBe("<title>");
	});

	it("writes the <html> and <head> start tags a document leaves out", async () => {
		expect(await rewritten(["<!DOCTYPE html><title>Shop</title>"])).toBe(
			`<!DOCTYPE html><html lang="ar" dir="rtl"><script type="importmap">{}</script><title>Shop</title>`,
		);
		expect(
			await rewritten(["<!DOCTYPE html><html><body>Shop</body></html>"]),
		).toBe(
			`<!DOCTYPE html><html lang="ar" dir="rtl"><script type="importmap">{}</script><body>Shop</body></html>`,
		);
	});

	it("passes a body that is no document as it is: a partial, or bytes that are not UTF-8", async () => {
		const partial = `<li lang="en">Shop</li>`;
		expect(await rewritten([partial])).toBe(partial);

		const encoded = (text: string) => new TextEncoder().encode(text);
		const latin1 = Uint8Array.of(
			...encoded('<!DOCTYPE html><html data-name="Ren'),
			0xe9,
			...encoded('"><head><title>'),
		);
		expect(await rewrittenBody([latin1]).bytes()).toEqual(latin1);
	});
});
