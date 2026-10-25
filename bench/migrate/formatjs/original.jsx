// The app as it runs on react-intl, its provider given the locale's messages.
import { renderToStaticMarkup } from "react-dom/server";
import { IntlProvider } from "react-intl";
import { Shop } from "./app/Shop.jsx";
import ar from "./lang/ar.json";
import en from "./lang/en.json";
import ru from "./lang/ru.json";

const catalogs = { en, ru, ar };

export async function render(locale, props) {
	return renderToStaticMarkup(
		<IntlProvider locale={locale} messages={catalogs[locale]}>
			<Shop {...props} />
		</IntlProvider>,
	);
}
