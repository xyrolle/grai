// The request's locale, resolved before Next renders anything. Next runs the proxy apart from the
// render, so it hands the locale over the way Next routes: as the first segment of the path the
// app's pages live under, app/[locale]/…, whatever the URL shows.
import { strategy } from "grai/next/output/config.js";
import { deLocalizeUrl } from "grai/next/output/runtime.js";
import { middleware } from "grai/next/output/server.js";
import { type NextRequest, NextResponse } from "next/server.js";

/**
 * Resolves the request's locale by the config's strategy and rewrites the request to the same
 * path under `/<locale>`. With the `url` strategy, a non-base locale's prefix is the locale, and
 * the base locale has none.
 */
export function proxy(request: NextRequest): NextResponse {
	return middleware(request, ({ locale }) => {
		const url = request.nextUrl.clone();
		const path = strategy.includes("url")
			? deLocalizeUrl(new URL(url.pathname, url.origin)).pathname
			: url.pathname;
		url.pathname = `/${locale}${path === "/" ? "" : path}`;
		return NextResponse.rewrite(url);
	});
}
