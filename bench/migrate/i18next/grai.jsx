// The app as grai migrate leaves it: its calls read grai's locale.
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./app/App.jsx";
import { setLocale } from "./out/runtime.js";

export async function render(locale, props) {
	setLocale(locale);
	return renderToStaticMarkup(<App locale={locale} {...props} />);
}
