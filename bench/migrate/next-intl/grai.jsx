// The app as grai migrate leaves it: its calls read grai's locale.
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "./app/App.jsx";
import { aboutTitle, visits } from "./app/about.js";
import { setLocale } from "./out/runtime.js";

export async function render(locale, props) {
	setLocale(locale);
	const page = renderToStaticMarkup(<App {...props} />);
	return `${page}|${await aboutTitle()}|${await visits(locale, props.count)}`;
}
