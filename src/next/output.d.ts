// The project's compiled output, as grai/next reads it. withGrai points `grai/next/output/*` at
// the config's outdir in both bundlers, so these are the app's own modules, one per layer.

declare module "grai/next/output/runtime.js" {
	export const locales: readonly string[];
	export function getLocale(): string;
	export function setLocale(locale: string): void;
	export function assertIsLocale(value: unknown): string;
	export function deLocalizeUrl(url: string | URL): URL;
}

declare module "grai/next/output/dispatch.js" {
	/** A request's locale, by its position in `locales`; `setLocale` in the request changes it in place. */
	export type RequestLocale = { index: number };
	export function bindRequests(storage: {
		getStore(): RequestLocale | undefined;
	}): void;
	export class GraiError extends Error {
		constructor(code: string, message: string);
		readonly code: string;
	}
}

declare module "grai/next/output/config.js" {
	export const strategy: readonly ("cookie" | "preferredLanguage" | "url")[];
}

declare module "grai/next/output/server.js" {
	export function middleware(
		request: Request,
		handler: (resolved: {
			request: Request;
			locale: string;
		}) => Response | Promise<Response>,
	): Promise<Response>;
}
