// Ordinal selection: grai's own plurals.js, as its compiler writes it, against Paraglide's
// registry with type=ordinal and an Intl.PluralRules of type ordinal cached per locale. Every
// variant is checked against Intl on 0–10,000 and on fractions before it is timed on 0–999. The
// bytes are what a bundle that selects one locale's ordinals ships, minified and gzipped.
//   node ordinals.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import { cacheDir, selectedApps } from "./apps.mjs";
import { graiModule } from "./grai.mjs";
import { formatNs, nanosecondsPer } from "./measure.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
import { recordResults } from "./results.mjs";

const locales = ["ro", "ru", "en"];
const { pluralModule, pluralName } = await import(graiModule("plurals.ts"));
const directory = join(cacheDir, "ordinals");
mkdirSync(directory, { recursive: true });
const plurals = join(directory, "plurals.js");
writeFileSync(plurals, pluralModule(locales));
const grai = await import(plurals);

const [app] = selectedApps(["synthetic"]);
const registryFile = `${await paraglideOutput(app)}/registry.js`;
const registry = await import(registryFile);
const ordinal = { type: "ordinal" };

/** The minified, gzipped bundle of `source`, a module beside grai's plurals.js. */
async function bytesOf(source) {
	const entry = join(directory, "entry.js");
	writeFileSync(entry, source);
	const build = await rolldown({ input: entry, logLevel: "silent" });
	const { output } = await build.generate({ format: "esm", minify: true });
	await build.close();
	return gzipSync(output[0].code).length;
}

const variants = (locale) => {
	const cached = new Intl.PluralRules(locale, ordinal);
	return {
		"Paraglide registry.plural": {
			select: (n) => registry.plural(locale, n, ordinal, true),
			source: `import { plural } from ${JSON.stringify(registryFile)};\nexport const select = (n) => plural(${JSON.stringify(locale)}, n, { type: "ordinal" }, true);\n`,
		},
		"Intl.PluralRules cached per locale": {
			select: (n) => cached.select(n),
			source: `const rules = new Intl.PluralRules(${JSON.stringify(locale)}, { type: "ordinal" });\nexport const select = (n) => rules.select(n);\n`,
		},
		"grai, compiled": {
			select: grai[pluralName(locale, "ordinal")],
			source: `export { ${pluralName(locale, "ordinal")} } from "./plurals.js";\n`,
		},
	};
};

const counts = [
	...Array.from({ length: 10_001 }, (_, index) => index),
	...[0.5, 1.5, 2.25, 11.1, 21.5, 101.01],
];
const integers = Array.from({ length: 1000 }, (_, index) => index);

console.log(
	`\n### ordinal selection, ns per call over 0–999, and bytes min+gzip (Node ${process.versions.node}, Paraglide ${paraglideVersion})\n`,
);
console.log(
	`| variant | ${locales.join(" | ")} | bytes (${locales.join(", ")}) |`,
);
console.log(`|---|${locales.map(() => "---|").join("")}---|`);
const rows = new Map();
for (const locale of locales) {
	const intl = new Intl.PluralRules(locale, ordinal);
	for (const [name, { select, source }] of Object.entries(variants(locale))) {
		for (const n of counts) {
			if (select(n) !== intl.select(n)) {
				throw new Error(
					`${name} selects ${select(n)} for ${n} in ${locale}; Intl says ${intl.select(n)}`,
				);
			}
		}
		const ns = nanosecondsPer(() => {
			let length = 0;
			for (const n of integers) length += select(n).length;
			return { length };
		}, integers.length);
		const bytes = await bytesOf(source);
		const row = rows.get(name) ?? { ns: {}, bytes: {} };
		rows.set(name, {
			ns: { ...row.ns, [locale]: ns },
			bytes: { ...row.bytes, [locale]: bytes },
		});
	}
}
for (const [name, { ns, bytes }] of rows) {
	console.log(
		`| ${name} | ${locales.map((locale) => formatNs(ns[locale])).join(" | ")} | ${locales.map((locale) => bytes[locale]).join(", ")} |`,
	);
}
recordResults(
	"ordinals",
	[...rows].map(([variant, { ns, bytes }]) => ({ variant, ns, bytes })),
	{ counts: integers.length },
);
