// The runtime's API: what apps import, and all of it. The compiler copies this file into the
// output as it is. Its code is in dispatch.js, beside what only the output's own modules call.
export {
	assertIsLocale,
	baseLocale,
	deLocalizeUrl,
	extractLocaleFromUrl,
	GraiError,
	getLocale,
	getTextDirection,
	isLocale,
	locales,
	localizeHref,
	localizeUrl,
	setLocale,
} from "./dispatch.js";
