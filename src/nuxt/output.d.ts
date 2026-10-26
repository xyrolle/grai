// The project's compiled output, as grai/nuxt's runtime reads it. The module points
// `grai/nuxt/output/*` at the config's outdir, in the app's build and in the server's alike, so
// these are the app's own modules.

declare module "grai/nuxt/output/internal.js" {
	export const locales: readonly string[];
	/** Whether the config gives each locale a host of its own: `domains`. */
	export const hostsLocales: boolean;
	export const strategy: readonly (
		| "cookie"
		| "localStorage"
		| "preferredLanguage"
		| "query"
		| "url"
	)[];
	export function getLocale(): string;
	export function assertIsLocale(value: unknown): string;
	export function getTextDirection(locale?: string): "ltr" | "rtl";
	export function extractLocaleFromUrl(url: string | URL): string;
	/** A request's locale, by its place in `locales`, which setLocale changes for the request. */
	export type RequestLocale = { index: number; origin?: string };
	export function bindRequests(storage: {
		getStore(): RequestLocale | undefined;
	}): void;
}

declare module "grai/nuxt/output/server.js" {
	export function localeOf(request: Request): Promise<string>;
	export function redirectOf(request: Request): Promise<Response | undefined>;
	export const vary: string;
}
