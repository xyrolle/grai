import { m } from "#lib/i18n/messages.js";
import type { PageServerLoad } from "./$types";

// The title comes from the server, as the text an app's loads return does.
export const load: PageServerLoad = () => ({ title: m.about_title() });
