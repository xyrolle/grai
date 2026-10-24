import type { Reroute } from "@sveltejs/kit/hooks";
import { deLocalizeUrl } from "#lib/i18n/runtime.js";

// /ro/about is the about page in Romanian: Kit routes the path without its locale prefix.
export const reroute: Reroute = ({ url }) => deLocalizeUrl(url).pathname;
