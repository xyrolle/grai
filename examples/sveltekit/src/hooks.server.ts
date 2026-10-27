import { handleLocale } from "@xyrolle/grai/sveltekit";
import { getTextDirection } from "#lib/i18n/runtime.js";
import { localeCopies, middleware } from "#lib/i18n/server.js";

// Resolves each request's locale by grai.config.json's strategy (here its URL prefix, the base
// locale having none), binds it while the page renders, and writes it to <html lang> and dir. A
// build with the locale copies points each page at its locale's.
export const handle = handleLocale({
	middleware,
	getTextDirection,
	localeCopies,
});
