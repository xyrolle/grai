// The locale of client components. On the server they render with the request's locale from the
// context LocaleProvider gives, since Next renders them outside any scope the app could bind. In
// a browser the runtime keeps the page's <html lang>, which the server wrote.
"use client";

import {
	bindRequests,
	type RequestLocale,
} from "@xyrolle/grai/next/output/internal.js";
import {
	assertIsLocale,
	GraiError,
	getLocale,
	locales,
	setLocale,
} from "@xyrolle/grai/next/output/runtime.js";
import {
	createContext,
	createElement,
	type ReactNode,
	use,
	useLayoutEffect,
} from "react";

/** The page's document, in a browser; on the server there is none. */
declare const document: { documentElement: { lang: string } };

/**
 * The request's locale while the server renders client components, read-only: what they render
 * on the server must be what they hydrate with in the browser.
 */
class ServerRenderLocale implements RequestLocale {
	readonly #index: number;

	constructor(index: number) {
		this.#index = index;
	}

	get index(): number {
		return this.#index;
	}

	set index(_: number) {
		throw new GraiError(
			"locale-unbound",
			"setLocale cannot change the locale while the server renders a client component. Call it in the browser, from an event.",
		);
	}
}

const RequestLocaleContext = createContext<RequestLocale | undefined>(
	undefined,
);

if (typeof document === "undefined") {
	bindRequests({
		getStore() {
			const record = use(RequestLocaleContext);
			if (record === undefined) {
				throw new GraiError(
					"locale-unbound",
					"A client component rendered on the server outside LocaleProvider. Wrap the root layout's body in <LocaleProvider locale={locale}>.",
				);
			}
			return record;
		},
	});
}

/**
 * Gives client components the request's locale while the server renders them. In a browser, a
 * page keeps the locale it was loaded in, so a client navigation into another locale, after
 * which React has written the new `<html lang>`, switches to it with setLocale, which loads the
 * page anew. A page whose `<html lang>` is not its locale is left as it is, never reloaded.
 */
export function LocaleProvider({
	locale,
	children,
}: {
	locale: string;
	children?: ReactNode;
}): ReactNode {
	useLayoutEffect(() => {
		if (locale !== getLocale() && document.documentElement.lang === locale) {
			setLocale(locale);
		}
	}, [locale]);
	return createElement(
		RequestLocaleContext,
		{ value: new ServerRenderLocale(locales.indexOf(assertIsLocale(locale))) },
		children,
	);
}
