import type { Reroute } from "@sveltejs/kit/hooks";
import { deLocalizeUrl } from "#lib/i18n/runtime.js";

// /ro/despre is the about page in Romanian: Kit routes the path as deLocalizeUrl gives it, without
// its locale prefix and in the route's words.
export const reroute: Reroute = ({ url }) => deLocalizeUrl(url).pathname;
