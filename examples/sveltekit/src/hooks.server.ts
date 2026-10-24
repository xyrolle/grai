import { handleLocale } from "grai/sveltekit";
import { getTextDirection } from "#lib/i18n/runtime.js";
import { middleware } from "#lib/i18n/server.js";

// Resolves each request's locale by grai.config.json's strategy (here its URL prefix, the base
// locale having none), binds it while the page renders, and writes it to <html lang> and dir.
export const handle = handleLocale({ middleware, getTextDirection });
