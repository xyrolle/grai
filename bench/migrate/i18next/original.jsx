// The app as it runs on react-i18next: i18next's default instance, which the hooks read, holds
// every locale's resources, and renders without escaping, as React escapes what it renders.
import i18next from "i18next";
import { renderToStaticMarkup } from "react-dom/server";
import { initReactI18next } from "react-i18next";
import { App } from "./app/App.jsx";
import arCart from "./locales/ar/cart.json";
import arCommon from "./locales/ar/common.json";
import enCart from "./locales/en/cart.json";
import enCommon from "./locales/en/common.json";
import ruCart from "./locales/ru/cart.json";
import ruCommon from "./locales/ru/common.json";

await i18next.use(initReactI18next).init({
	resources: {
		en: { common: enCommon, cart: enCart },
		ru: { common: ruCommon, cart: ruCart },
		ar: { common: arCommon, cart: arCart },
	},
	lng: "en",
	fallbackLng: false,
	interpolation: { escapeValue: false },
	initAsync: false,
});

export async function render(locale, props) {
	await i18next.changeLanguage(locale);
	return renderToStaticMarkup(<App locale={locale} {...props} />);
}
