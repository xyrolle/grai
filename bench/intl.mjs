// Number and date formatting inside a message: a new Intl formatter per call, Paraglide's registry
// (a cache keyed by the serialized options), one formatter per locale and options made once, as
// the compiler arranges it, and grai's compiled messages themselves, called on the server with a
// locale, so each call also reads the locale and runs its message's function.
//   node intl.mjs
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cacheDir, selectedApps } from "./apps.mjs";
import { graiEntry } from "./grai.mjs";
import { formatNs, nanosecondsPer } from "./measure.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";

const [app] = selectedApps(["synthetic"]);
const registry = await import(`${await paraglideOutput(app)}/registry.js`);
const numberOptions = { style: "currency", currency: "EUR" };
const dateOptions = { dateStyle: "medium", timeZone: "UTC" };
const amounts = Array.from({ length: 200 }, (_, index) => index * 12.5);
const dates = amounts.map((amount) =>
	new Date(Date.UTC(2026, 0, 1) + amount * 86_400_000).toISOString(),
);

/** grai's output for two messages, a price and a day, formatted as the variants format them. */
async function graiMessages() {
	const dir = join(cacheDir, "intl-grai");
	rmSync(dir, { recursive: true, force: true });
	mkdirSync(join(dir, "messages"), { recursive: true });
	for (const locale of ["ro", "ru"]) {
		writeFileSync(
			join(dir, "messages", `${locale}.json`),
			JSON.stringify({
				price: "{amount :number style=currency currency=EUR}",
				day: "{date :datetime dateStyle=medium timeZone=UTC}",
			}),
		);
	}
	const config = join(dir, "grai.config.json");
	writeFileSync(
		config,
		JSON.stringify({
			locales: ["ro", "ru"],
			baseLocale: "ro",
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
	);
	const { compile } = await import(graiEntry("."));
	const { errors } = await compile(config);
	if (errors.length > 0) throw new Error(errors[0].message);
	return (await import(pathToFileURL(join(dir, "out", "messages.js")).href)).m;
}
const m = await graiMessages();

function variants(locale) {
	const number = new Intl.NumberFormat(locale, numberOptions);
	const date = new Intl.DateTimeFormat(locale, dateOptions);
	return {
		"new formatter per call": [
			(n) => new Intl.NumberFormat(locale, numberOptions).format(n),
			(d) => new Intl.DateTimeFormat(locale, dateOptions).format(new Date(d)),
		],
		"Paraglide registry": [
			(n) => registry.number(locale, n, numberOptions, true),
			(d) => registry.datetime(locale, d, dateOptions, true),
		],
		"one formatter per locale and options": [
			(n) => number.format(n),
			(d) => date.format(new Date(d)),
		],
		"grai's compiled messages": [
			(n) => m.price({ amount: n }, { locale }),
			(d) => m.day({ date: new Date(d) }, { locale }),
		],
	};
}

console.log(
	`\n### formatting in a message, ns per call (Node ${process.versions.node}, Paraglide ${paraglideVersion})\n`,
);
console.log("| variant | locale | number | date |\n|---|---|---|---|");
for (const locale of ["ro", "ru"]) {
	const expected = variants(locale)["new formatter per call"];
	for (const [name, [number, date]] of Object.entries(variants(locale))) {
		if (
			number(amounts[7]) !== expected[0](amounts[7]) ||
			date(dates[7]) !== expected[1](dates[7])
		)
			throw new Error(`${name} formats differently in ${locale}`);
		const formatAll = (format, values) => () => {
			let length = 0;
			for (const value of values) length += format(value).length;
			return { length };
		};
		const numberNs = nanosecondsPer(formatAll(number, amounts), amounts.length);
		const dateNs = nanosecondsPer(formatAll(date, dates), dates.length);
		console.log(
			`| ${name} | ${locale} | ${formatNs(numberNs)} | ${formatNs(dateNs)} |`,
		);
	}
}
