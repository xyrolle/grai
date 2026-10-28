// Formatting options that inputs give, in a message: grai's compiled output with the currency or
// the time zone written in the message and given by an input (`currency=$code`, a formatter kept
// per value), against Paraglide's registry, which takes the options each call builds, and a new
// Intl formatter per call. Then a time zone bound once per request, as the locale is: a read of the
// request's store per date, beside a formatter kept per zone. Every variant runs inside a request
// bound to the first zone, and its text is checked against a new Intl formatter's before it is
// timed.
//   node option-inputs.mjs
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cacheDir } from "./apps.mjs";
import { graiEntry } from "./grai.mjs";
import { formatNs, nanosecondsPer } from "./measure.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";

const locales = ["ro", "ru", "en"];
const catalog = {
	price_written: "{amount: number style=currency currency=EUR}",
	price: "{amount: number style=currency currency=$code}",
	shipped_written: "{when: datetime timeZone=Europe/Chisinau}",
	shipped: "{when: datetime timeZone=$zone}",
};
const codes = { one: ["EUR"], three: ["EUR", "USD", "MDL"] };
const zones = {
	one: ["Europe/Chisinau"],
	three: ["Europe/Chisinau", "UTC", "America/New_York"],
};
const CALLS = 300;
const amounts = Array.from({ length: CALLS }, (_, index) => index * 12.5);
const times = amounts.map(
	(amount) => Date.UTC(2026, 0, 1) + amount * 3_600_000,
);

/** The catalogs, as grai's project and Paraglide's app read them. */
function writeCatalogs() {
	const directory = join(cacheDir, "option-inputs");
	mkdirSync(join(directory, "messages"), { recursive: true });
	const catalogs = {};
	for (const locale of locales) {
		catalogs[locale] = join(directory, "messages", `${locale}.json`);
		writeFileSync(catalogs[locale], JSON.stringify(catalog));
	}
	writeFileSync(
		join(directory, "grai.config.json"),
		JSON.stringify({
			locales,
			baseLocale: "ro",
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
	);
	return { directory, catalogs };
}

const { directory, catalogs } = writeCatalogs();
const { compile } = await import(graiEntry("."));
const { errors } = await compile(join(directory, "grai.config.json"));
if (errors.length > 0) throw new Error(errors.map((e) => e.message).join("\n"));
const { m } = await import(join(directory, "out", "messages.js"));
const paraglide = await paraglideOutput({
	id: "option-inputs",
	locales,
	baseLocale: "ro",
	catalogs,
	compilerOptions: { strategy: ["baseLocale"] },
});
const p = await import(join(paraglide, "messages.js"));

/** A prototype of a time zone bound per request: the zone read from the request's store. */
const requests = new AsyncLocalStorage();
function boundZone(locale) {
	const made = new Map();
	return (when) => {
		const zone = requests.getStore();
		let formatter = made.get(zone);
		if (formatter === undefined) {
			formatter = new Intl.DateTimeFormat(locale, {
				dateStyle: "medium",
				timeStyle: "short",
				timeZone: zone,
			});
			made.set(zone, formatter);
		}
		return formatter.format(when);
	};
}

/**
 * Each variant, as a function of the call's position giving that call's text. The options written
 * in the message, and a zone bound per request, are one currency and one zone, so they are timed
 * with one value only.
 */
function variants(locale, count) {
	const options = { locale };
	const code = (n) => codes[count][n % codes[count].length];
	const zone = (n) => zones[count][n % zones[count].length];
	const bound = boundZone(locale);
	const one = count === "one";
	return {
		number: {
			...(one && {
				"grai, currency=EUR written": (n) =>
					m.price_written({ amount: amounts[n] }, options),
			}),
			"grai, currency=$code": (n) =>
				m.price({ amount: amounts[n], code: code(n) }, options),
			"Paraglide, currency=$code": (n) =>
				p.price({ amount: amounts[n], code: code(n) }, options),
			"a new Intl formatter per call": (n) =>
				new Intl.NumberFormat(locale, {
					style: "currency",
					currency: code(n),
				}).format(amounts[n]),
		},
		date: {
			...(one && {
				"grai, timeZone written": (n) =>
					m.shipped_written({ when: times[n] }, options),
			}),
			"grai, timeZone=$zone": (n) =>
				m.shipped({ when: times[n], zone: zone(n) }, options),
			"Paraglide, timeZone=$zone": (n) =>
				p.shipped({ when: times[n], zone: zone(n) }, options),
			...(one && {
				"prototype, the time zone bound per request": (n) => bound(times[n]),
			}),
			"a new Intl formatter per call": (n) =>
				new Intl.DateTimeFormat(locale, {
					dateStyle: "medium",
					timeStyle: "short",
					timeZone: zone(n),
				}).format(times[n]),
		},
	};
}

console.log(
	`\n### options inputs give, ns per call (Node ${process.versions.node}, Paraglide ${paraglideVersion})\n`,
);
console.log("| variant | locale | values | ns per call |\n|---|---|---|---|");
for (const locale of ["ro", "ru"]) {
	for (const count of ["one", "three"]) {
		for (const named of Object.values(variants(locale, count))) {
			const expected = named["a new Intl formatter per call"];
			for (const [name, call] of Object.entries(named)) {
				for (const n of [0, 1, 2, 7]) {
					const text = requests.run(zones.one[0], () => call(n));
					if (text !== expected(n))
						throw new Error(
							`${name} formats otherwise in ${locale}: ${text} against ${expected(n)}`,
						);
				}
				const run = () => {
					let text = "";
					for (let n = 0; n < CALLS; n++) text += call(n);
					return text;
				};
				const ns = requests.run(zones.one[0], () => nanosecondsPer(run, CALLS));
				console.log(`| ${name} | ${locale} | ${count} | ${formatNs(ns)} |`);
			}
		}
	}
}
