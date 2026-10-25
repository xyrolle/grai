// The app as it runs on next-intl, through use-intl, whose provider and translators next-intl's
// are: next-intl itself needs Next.js to run.
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "use-intl";
import { App } from "./app/App.jsx";
import { aboutTitle, visits } from "./app/about.js";
import ar from "./messages/ar.json";
import en from "./messages/en.json";
import ru from "./messages/ru.json";
import { setRequestLocale } from "./next-intl-server.js";

const catalogs = { en, ru, ar };

export async function render(locale, props) {
	setRequestLocale(locale);
	const page = renderToStaticMarkup(
		<IntlProvider locale={locale} messages={catalogs[locale]} timeZone="UTC">
			<App {...props} />
		</IntlProvider>,
	);
	return `${page}|${await aboutTitle()}|${await visits(locale, props.count)}`;
}
