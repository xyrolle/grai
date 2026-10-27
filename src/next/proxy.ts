// The request's locale, resolved before Next renders anything. Next runs the proxy apart from the
// render, so it hands the locale over the way Next routes: as the first segment of the path the
// app's pages live under, app/[locale]/…, whatever the URL shows.
import { strategy } from "@xyrolle/grai/next/output/internal.js";
import { deLocalizeUrl } from "@xyrolle/grai/next/output/runtime.js";
import { middleware } from "@xyrolle/grai/next/output/server.js";
import { type NextRequest, NextResponse } from "next/server.js";

/**
 * Resolves the request's locale by the config's strategy and rewrites the request to the same
 * path under `/<locale>`, its `Vary` listing the request headers the strategy reads. With the
 * `url` strategy, a non-base locale's prefix is the locale, and the base locale has none.
 */
export function proxy(request: NextRequest): Promise<Response> {
	return middleware(request, ({ locale }) => {
		const url = request.nextUrl.clone();
		const path = strategy.includes("url")
			? deLocalizeUrl(new URL(url.pathname, url.origin)).pathname
			: url.pathname;
		url.pathname = `/${locale}${path === "/" ? "" : path}`;
		// Next started on a loopback address, `127.0.0.1` or `[::1]`, takes this rewrite for an external
		// one and sends it back to itself, where this proxy rewrites it again: vercel/next.js#94745,
		// with a fix in review, vercel/next.js#95917 (`docs/followups.md`).
		return NextResponse.rewrite(url);
	});
}
