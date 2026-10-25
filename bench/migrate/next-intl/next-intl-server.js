// next-intl's getTranslations, as it runs in a request without Next.js: use-intl's translator,
// which next-intl's is, for the request's locale and its messages.
import { createTranslator } from "use-intl";
import ar from "./messages/ar.json";
import en from "./messages/en.json";
import ru from "./messages/ru.json";

const catalogs = { en, ru, ar };
let requestLocale = "en";

export function setRequestLocale(locale) {
	requestLocale = locale;
}

export async function getTranslations(options) {
	const { locale = requestLocale, namespace } =
		typeof options === "object" ? options : { namespace: options };
	return createTranslator({
		locale,
		messages: catalogs[locale],
		namespace,
		timeZone: "UTC",
	});
}
