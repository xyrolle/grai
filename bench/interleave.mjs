// Is a locale bound per request safe when requests interleave? 100 requests start together, half
// in one locale and half in another; each renders a message, awaits, and renders it again, as an
// async server render does. Binding through AsyncLocalStorage keeps each request's locale; binding
// a module variable hands every request the locale of whichever started last.
//   node interleave.mjs
import { join } from "node:path";
import { selectedApps } from "./apps.mjs";
import { writePrototype } from "./prototype.mjs";

const [app] = selectedApps(["synthetic"]);
const prototype = writePrototype(app);
const plain = (value) => typeof value === "string" && !value.includes("{");
const key = Object.keys(app.messages[app.baseLocale]).find((name) =>
	app.locales.every((locale) => plain(app.messages[locale][name])),
);
const [first, second] = app.locales;

for (const [name, file] of [
	["AsyncLocalStorage", "server.js"],
	["module variable", "server-variable.js"],
]) {
	const entry = await import(join(prototype, file));
	const request = (locale) =>
		entry.withLocale(locale, async () => {
			const rendered = [entry[key]()];
			await new Promise((resolve) => setTimeout(resolve, 1));
			rendered.push(entry[key]());
			return rendered.filter((text) => text !== app.messages[locale][key])
				.length;
		});
	const wrong = await Promise.all(
		Array.from({ length: 100 }, (_, index) =>
			request(index % 2 ? second : first),
		),
	);
	console.log(
		`${name}: ${wrong.reduce((sum, count) => sum + count, 0)} of 200 renders in another request's locale`,
	);
}
