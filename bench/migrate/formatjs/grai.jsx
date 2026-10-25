// The app as grai migrate leaves it: its calls read grai's locale.
import { renderToStaticMarkup } from "react-dom/server";
import { Shop } from "./app/Shop.jsx";
import { setLocale } from "./out/runtime.js";

export async function render(locale, props) {
	setLocale(locale);
	return renderToStaticMarkup(<Shop {...props} />);
}
