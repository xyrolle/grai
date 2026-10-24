// Plural selection: Paraglide's registry, a new Intl.PluralRules per call, one cached per locale,
// CLDR's rules compiled into a function (make-plural), and the same rules with an integer path
// first, since a count is almost always an integer. Every variant is checked against Intl on
// 0–10,000 and on fractions before it is timed; the bytes are each one's minified, gzipped code.
//   node plurals.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { minifySync } from "rolldown/utils";
import { cacheDir, selectedApps } from "./apps.mjs";
import { formatNs, nanosecondsPer } from "./measure.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
import { pluralRuleOf } from "./prototype.mjs";

/** CLDR's cardinal rules for integers only (v = 0), as a compiler would emit them per locale. */
const integerRules = {
	en: "(n) => n === 1 ? 'one' : 'other'",
	ro: "(n) => { const n100 = n % 100; return n === 1 ? 'one' : n === 0 || (n100 >= 1 && n100 <= 19) ? 'few' : 'other'; }",
	ru: "(n) => { const n10 = n % 10, n100 = n % 100; return n10 === 1 && n100 !== 11 ? 'one' : n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14) ? 'few' : 'many'; }",
};

function variantSources(locale) {
	const cldr = pluralRuleOf(locale);
	return {
		"new Intl.PluralRules per call": `(n) => new Intl.PluralRules(${JSON.stringify(locale)}).select(n)`,
		"Intl.PluralRules cached per locale": `(() => { const rules = new Intl.PluralRules(${JSON.stringify(locale)}); return (n) => rules.select(n); })()`,
		"CLDR rules compiled (make-plural)": cldr,
		"compiled, integer path first": `(() => { const integer = ${integerRules[locale]}; const general = ${cldr}; return (n) => Number.isInteger(n) && n >= 0 ? integer(n) : general(n); })()`,
	};
}

const gzipped = (code) =>
	gzipSync(minifySync("plural.js", `export const plural = ${code};`).code)
		.length;

const [app] = selectedApps(["synthetic"]);
const registry = await import(`${await paraglideOutput(app)}/registry.js`);
const integers = Array.from({ length: 1000 }, (_, index) => index);
const fractions = [0.5, 1.5, 2.25, 11.1, 21.5, 101.01];

console.log(
	`\n### plural selection, ns per call over 0–999 (Node ${process.versions.node}, Paraglide ${paraglideVersion}); bytes min+gzip\n`,
);
console.log("| variant | ro | ru | en | bytes (ru) |");
console.log("|---|---|---|---|---|");
const rows = new Map();
for (const locale of ["ro", "ru", "en"]) {
	const intl = new Intl.PluralRules(locale);
	const sources = Object.entries(variantSources(locale)).map(
		([name, source]) => `${JSON.stringify(name)}: ${source}`,
	);
	const module = join(cacheDir, "plurals", `${locale}.js`);
	mkdirSync(join(cacheDir, "plurals"), { recursive: true });
	writeFileSync(
		module,
		`export const variants = {\n${sources.join(",\n")}\n};\n`,
	);
	const variants = {
		"Paraglide registry.plural": (n) => registry.plural(locale, n, {}, true),
		...(await import(module)).variants,
	};
	for (const [name, select] of Object.entries(variants)) {
		for (const n of [
			...Array.from({ length: 10001 }, (_, index) => index),
			...fractions,
		]) {
			if (select(n) !== intl.select(n))
				throw new Error(
					`${name} selects ${select(n)} for ${n} in ${locale}; Intl says ${intl.select(n)}`,
				);
		}
		const ns = nanosecondsPer(() => {
			let length = 0;
			for (const n of integers) length += select(n).length;
			return { length };
		}, integers.length);
		rows.set(name, { ...rows.get(name), [locale]: ns });
	}
}
for (const [name, ns] of rows) {
	const source = variantSources("ru")[name];
	const bytes = source ? gzipped(source) : "registry";
	console.log(
		`| ${name} | ${formatNs(ns.ro)} | ${formatNs(ns.ru)} | ${formatNs(ns.en)} | ${bytes} |`,
	);
}
