// Number and date formatting inside a message: a new Intl formatter per call, Paraglide's registry
// (a cache keyed by the serialized options), and one formatter the compiler creates once per
// locale and options at module scope, since a message's options are known when it compiles.
//   node intl.mjs
import { selectedApps } from "./apps.mjs";
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
