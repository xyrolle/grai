// Ordinal selection: grai's own plurals.js, as its compiler writes it, against Paraglide's
// registry with type=ordinal and an Intl.PluralRules of type ordinal cached per locale. Every
// variant is checked against Intl on 0–10,000 and on fractions before it is timed on 0–999. The
// bytes are what a bundle that selects one locale's ordinals ships, minified and gzipped. Each
// variant is timed in a process of its own, once a round, the order rotating from round to round
// (rounds.mjs); its figure is the median of its rounds, and every sample is kept.
//   ROUNDS=6 node ordinals.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import { cacheDir, selectedApps } from "./apps.mjs";
import { graiParts } from "./grai.mjs";
import { formatNs, nanosecondSamples } from "./measure.mjs";
import { median } from "./medians.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
import { recordResults } from "./results.mjs";
import {
	inProcess,
	inRounds,
	pairedRatio,
	ratioText,
	roundCount,
	roundsRecord,
} from "./rounds.mjs";

const locales = ["ro", "ru", "en"];
/** The timed batches a variant takes in each locale, each round. */
const SAMPLES = 11;
const self = new URL(import.meta.url).pathname;
const directory = join(cacheDir, "ordinals");
const plurals = join(directory, "plurals.js");
const ordinal = { type: "ordinal" };
const graiName = "grai, compiled";

/**
 * Each variant: its rule in a locale, made only in the process that times it, from the registry
 * Paraglide compiled, and its source as a bundle beside grai's plurals.js imports it.
 */
const variants = {
	"Paraglide registry.plural": {
		select: async (locale, registryFile) => {
			const registry = await import(registryFile);
			return (n) => registry.plural(locale, n, ordinal, true);
		},
		source: (locale, registryFile) =>
			`import { plural } from ${JSON.stringify(registryFile)};\nexport const select = (n) => plural(${JSON.stringify(locale)}, n, { type: "ordinal" }, true);\n`,
	},
	"Intl.PluralRules cached per locale": {
		select: async (locale) => {
			const cached = new Intl.PluralRules(locale, ordinal);
			return (n) => cached.select(n);
		},
		source: (locale) =>
			`const rules = new Intl.PluralRules(${JSON.stringify(locale)}, { type: "ordinal" });\nexport const select = (n) => rules.select(n);\n`,
	},
	[graiName]: {
		select: async (locale) => {
			const { pluralName } = await import(graiParts);
			return (await import(plurals))[pluralName(locale, "ordinal")];
		},
		source: async (locale) => {
			const { pluralName } = await import(graiParts);
			return `export { ${pluralName(locale, "ordinal")} } from "./plurals.js";\n`;
		},
	},
};
const names = Object.keys(variants);

/** The minified, gzipped bundle of `source`, a module beside grai's plurals.js. */
async function bytesOf(source) {
	const entry = join(directory, "entry.js");
	writeFileSync(entry, source);
	const build = await rolldown({ input: entry, logLevel: "silent" });
	const { output } = await build.generate({ format: "esm", minify: true });
	await build.close();
	return gzipSync(output[0].code).length;
}

const counts = [
	...Array.from({ length: 10_001 }, (_, index) => index),
	...[0.5, 1.5, 2.25, 11.1, 21.5, 101.01],
];
const integers = Array.from({ length: 1000 }, (_, index) => index);

/** Runs in the child: the variant checked against Intl, then timed, in each locale. */
async function child(name, registryFile) {
	const samples = {};
	for (const locale of locales) {
		const select = await variants[name].select(locale, registryFile);
		const intl = new Intl.PluralRules(locale, ordinal);
		for (const n of counts) {
			if (select(n) !== intl.select(n)) {
				throw new Error(
					`${name} selects ${select(n)} for ${n} in ${locale}; Intl says ${intl.select(n)}`,
				);
			}
		}
		samples[locale] = nanosecondSamples(
			() => {
				let length = 0;
				for (const n of integers) length += select(n).length;
				return { length };
			},
			integers.length,
			{ samples: SAMPLES },
		);
	}
	console.log(JSON.stringify(samples));
}

if (process.argv[2] === "--child") {
	await child(process.argv[3], process.argv[4]);
} else {
	const { pluralModule } = await import(graiParts);
	mkdirSync(directory, { recursive: true });
	writeFileSync(plurals, pluralModule(locales));
	const [app] = selectedApps(["synthetic"]);
	const registryFile = join(await paraglideOutput(app), "registry.js");
	const rounds = roundCount(names.length, 2);
	const kept = await inRounds(names, rounds, (name) =>
		inProcess(self, ["--child", name, registryFile]),
	);
	/** A variant's figure in a locale, round by round: the median of the round's samples. */
	const byRound = (name, locale) =>
		kept.map(({ measured }) => median(measured.get(name)[locale]));
	const each = (figure) =>
		Object.fromEntries(locales.map((locale) => [locale, figure(locale)]));
	console.log(
		`\n### ordinal selection, ns per call over 0–999, and bytes min+gzip (Node ${process.versions.node}, Paraglide ${paraglideVersion}), medians of ${rounds} rounds at a load of ${kept.map(({ load }) => load.toFixed(0)).join(", ")}\n`,
	);
	console.log(
		`| variant | ${locales.join(" | ")} | bytes (${locales.join(", ")}) | ru, × grai's (interval) |`,
	);
	console.log(`|---|${locales.map(() => "---|").join("")}---|---|`);
	const recorded = [];
	for (const name of names) {
		const ns = each((locale) => median(byRound(name, locale)));
		const bytes = {};
		for (const locale of locales)
			bytes[locale] = await bytesOf(
				await variants[name].source(locale, registryFile),
			);
		const ratio = each((locale) =>
			pairedRatio(byRound(name, locale), byRound(graiName, locale)),
		);
		console.log(
			`| ${name} | ${locales.map((locale) => formatNs(ns[locale])).join(" | ")} | ${locales.map((locale) => bytes[locale]).join(", ")} | ${ratioText(ratio.ru)} |`,
		);
		recorded.push({
			variant: name,
			ns,
			bytes,
			ratio,
			rounds: each((locale) => byRound(name, locale)),
			samples: each((locale) =>
				kept.map(({ measured }) => measured.get(name)[locale]),
			),
		});
	}
	recordResults("ordinals", recorded, {
		counts: integers.length,
		samplesPerRound: SAMPLES,
		reference: graiName,
		rounds: roundsRecord(kept),
	});
}
