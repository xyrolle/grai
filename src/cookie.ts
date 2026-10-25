/**
 * The locale's cookie, which the `cookie` strategy reads and `setLocale` writes: the config's
 * `cookieName`, `cookieMaxAge`, `cookieDomain` and `cookieSameSite`, named as Paraglide names them.
 */

import type { GraiError } from "./error.ts";

export type Cookie = {
	name: string;
	/** The seconds a browser keeps it. */
	maxAge: number;
	/** The host it goes to with its subdomains, or undefined for the page's host alone. */
	domain: string | undefined;
	sameSite: "lax" | "strict" | "none";
	/** Whether it is Secure always, as SameSite=None and the __Secure- and __Host- names need, or on https. */
	secure: "always" | "https";
};

/** The cookie's fields in the config, which only the `cookie` strategy reads. */
export const cookieFields = [
	"cookieName",
	"cookieMaxAge",
	"cookieDomain",
	"cookieSameSite",
] as const;

/** A cookie's name: an HTTP token, the characters RFC 6265 allows in it. */
const token = /^[\w!#$%&'*+\-.^`|~]+$/;
/** The longest browsers keep a cookie: 400 days, in seconds. */
const longestMaxAge = 400 * 24 * 60 * 60;
/** A host name: labels of letters, digits and hyphens, joined by dots. */
const hostName = /^[a-z\d-]+(\.[a-z\d-]+)*$/i;
const sameSites = ["lax", "strict", "none"];

/**
 * The config's cookie, checked, or undefined when the strategy does not list `cookie`, which then
 * takes none of the cookie's fields.
 */
export function readCookie(
	raw: Readonly<Record<string, unknown>>,
	readsCookie: boolean,
	invalid: (detail: string) => GraiError,
): Cookie | undefined {
	if (!readsCookie) {
		const stray = cookieFields.find((field) => raw[field] !== undefined);
		if (stray === undefined) return undefined;
		throw invalid(
			`"${stray}" is read only by the "cookie" strategy, which "strategy" does not list`,
		);
	}
	const {
		cookieName: name,
		cookieMaxAge: maxAge = longestMaxAge,
		cookieDomain: domain,
		cookieSameSite: sameSite = "lax",
	} = raw;
	if (typeof name !== "string" || name === "") {
		throw invalid(
			'"cookieName" must name the cookie the "cookie" strategy reads',
		);
	}
	if (!token.test(name)) {
		throw invalid(
			'"cookieName" must be a cookie name, as RFC 6265 has it: letters, digits and !#$%&\'*+-.^_`|~, without spaces',
		);
	}
	if (
		typeof maxAge !== "number" ||
		!Number.isInteger(maxAge) ||
		maxAge < 1 ||
		maxAge > longestMaxAge
	) {
		throw invalid(
			`"cookieMaxAge" must be the seconds the cookie lasts, a whole number from 1 to ${longestMaxAge}, as browsers keep a cookie 400 days at most`,
		);
	}
	if (
		domain !== undefined &&
		(typeof domain !== "string" || !hostName.test(domain))
	) {
		throw invalid(
			'"cookieDomain" must be a host name, such as "example.com", without a scheme, a port, a path or a leading dot',
		);
	}
	if (typeof sameSite !== "string" || !isSameSite(sameSite)) {
		throw invalid('"cookieSameSite" must be "lax", "strict" or "none"');
	}
	const prefix = /^__(secure|host)-/i.exec(name)?.[1]?.toLowerCase();
	if (prefix === "host" && domain !== undefined) {
		throw invalid(
			`"cookieDomain" cannot go with "${name}": a browser keeps a __Host- cookie only for the host that set it, with no Domain`,
		);
	}
	const secure =
		prefix !== undefined || sameSite === "none" ? "always" : "https";
	return { name, maxAge, domain, sameSite, secure };
}

function isSameSite(value: string): value is Cookie["sameSite"] {
	return sameSites.includes(value);
}

/**
 * What `setLocale` writes after the cookie's value: every attribute but `secure`, which it adds as
 * `secure` says, since a browser drops a Secure cookie that an http page sets.
 */
export function cookieAttributes({ maxAge, domain, sameSite }: Cookie): string {
	const scope = domain === undefined ? "" : `; domain=${domain}`;
	return `; path=/; max-age=${maxAge}${scope}; samesite=${sameSite}`;
}
