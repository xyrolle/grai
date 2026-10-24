// The project's compiled output, as grai/nuxt's runtime reads it. The module points
// `grai/nuxt/output/*` at the config's outdir, in the app's build and in the server's alike, so
// these are the app's own modules.

declare module "grai/nuxt/output/runtime.js" {
	export const locales: readonly string[];
	export function getLocale(): string;
	export function assertIsLocale(value: unknown): string;
	export function getTextDirection(locale?: string): "ltr" | "rtl";
	export function extractLocaleFromUrl(url: string | URL): string;
	export function bindRequests(storage: {
		getStore(): number | undefined;
		enterWith(index: number): void;
	}): void;
	export class GraiError extends Error {
		constructor(code: string, message: string);
		readonly code: string;
	}
}

declare module "grai/nuxt/output/config.js" {
	export const strategy: readonly ("cookie" | "preferredLanguage" | "url")[];
}

declare module "grai/nuxt/output/server.js" {
	export function middleware<Result>(
		request: Request,
		handler: (resolved: { request: Request; locale: string }) => Result,
	): Result;
}
