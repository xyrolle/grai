// The project's compiled output, as grai/next reads it. withGrai points `grai/next/output/*` at
// the config's outdir in both bundlers, so these are the app's own modules, one per layer.

declare module "grai/next/output/runtime.js" {
	export const locales: readonly string[];
	export function getLocale(): string;
	export function setLocale(locale: string): void;
	export function assertIsLocale(value: unknown): string;
	export function deLocalizeUrl(url: string | URL): URL;
	export function bindRequests(storage: {
		getStore(): number | undefined;
		enterWith(index: number): void;
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
	export function middleware<Result>(
		request: Request,
		handler: (resolved: { request: Request; locale: string }) => Result,
	): Result;
}
