// Plural selection: Paraglide's registry, a new Intl.PluralRules per call, one cached per locale,
// grai's rules as its compiler emits them in plurals.js, and two experiments: CLDR's rules
// compiled into a function (make-plural), and the same rules with an integer path first, since a
// count is almost always an integer. Every variant is checked against Intl on 0–10,000 and on
// fractions before it is timed; the bytes are each one's minified, gzipped code, grai's bundled
// from its output with what the rule calls. Each variant is timed in a process of its own, once a
// round, the order rotating from round to round (rounds.mjs); its figure is the median of its
// rounds, and every sample is kept.
//   ROUNDS=6 node plurals.mjs
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import { minifySync } from "rolldown/utils";
import { cacheDir, selectedApps } from "./apps.mjs";
import { graiOutput } from "./grai.mjs";
import { formatNs, nanosecondSamples } from "./measure.mjs";
import { median } from "./medians.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";
import { pluralRuleOf } from "./prototype.mjs";
import { recordResults } from "./results.mjs";
import {
	inProcess,
	inRounds,
	pairedRatio,
	ratioText,
	roundCount,
	roundsRecord,
} from "./rounds.mjs";

const LOCALES = ["ro", "ru", "en"];
/** The timed batches a variant takes in each locale, each round. */
const SAMPLES = 11;
const self = new URL(import.meta.url).pathname;

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

const paraglideName = "Paraglide registry.plural";
const emittedName = "grai's rules, as plurals.js has them";
const names = [
	paraglideName,
	emittedName,
	...Object.keys(variantSources(LOCALES[0])),
];

/** grai's plurals.js in its output, where the compiler wrote it. */
function emittedFile(outdir) {
	const file = readdirSync(outdir).find((name) =>
		/^plurals-\w+\.js$/.test(name),
	);
	if (file === undefined)
		throw new Error(`grai's output ${outdir} has no plurals.js`);
	return join(outdir, file);
}

/** The minified, gzipped bytes of a locale's emitted rule, bundled with what it calls. */
async function emittedBytes(pluralsFile, locale) {
	const build = await rolldown({
		input: "entry",
		plugins: [
			{
				name: "entry",
				resolveId: (id) => (id === "entry" ? id : null),
				load: (id) =>
					id === "entry"
						? `export { plural_${locale} } from ${JSON.stringify(pluralsFile)};`
						: null,
			},
		],
		logLevel: "silent",
	});
	const { output } = await build.generate({ format: "esm", minify: true });
	await build.close();
	return gzipSync(output[0].code).length;
}
const integers = Array.from({ length: 1000 }, (_, index) => index);
const fractions = [0.5, 1.5, 2.25, 11.1, 21.5, 101.01];

/** The variant's rule in a locale, made only in the process that times it. */
async function selectOf(name, locale, { registryFile, pluralsFile }) {
	if (name === paraglideName) {
		const registry = await import(registryFile);
		return (n) => registry.plural(locale, n, {}, true);
	}
	if (name === emittedName)
		return (await import(pathToFileURL(pluralsFile).href))[`plural_${locale}`];
	const directory = join(cacheDir, "plurals");
	mkdirSync(directory, { recursive: true });
	const module = join(directory, `${locale}-${names.indexOf(name)}.js`);
	writeFileSync(
		module,
		`export const select = ${variantSources(locale)[name]};\n`,
	);
	return (await import(module)).select;
}

/** Runs in the child: the variant checked against Intl, then timed, in each locale. */
async function child(name, files) {
	const samples = {};
	for (const locale of LOCALES) {
		const select = await selectOf(name, locale, files);
		const intl = new Intl.PluralRules(locale);
		for (const n of [
			...Array.from({ length: 10001 }, (_, index) => index),
			...fractions,
		]) {
			if (select(n) !== intl.select(n))
				throw new Error(
					`${name} selects ${select(n)} for ${n} in ${locale}; Intl says ${intl.select(n)}`,
				);
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
	const [, , , name, registryFile, pluralsFile] = process.argv;
	await child(name, { registryFile, pluralsFile });
} else {
	const [app] = selectedApps(["synthetic"]);
	const registryFile = join(await paraglideOutput(app), "registry.js");
	const pluralsFile = emittedFile((await graiOutput(app)).outdir);
	const rounds = roundCount(names.length);
	const kept = await inRounds(names, rounds, (name) =>
		inProcess(self, ["--child", name, registryFile, pluralsFile]),
	);
	/** A variant's figure in a locale, round by round: the median of the round's samples. */
	const byRound = (name, locale) =>
		kept.map(({ measured }) => median(measured.get(name)[locale]));
	console.log(
		`\n### plural selection, ns per call over 0–999 (Node ${process.versions.node}, Paraglide ${paraglideVersion}), medians of ${rounds} rounds at a load of ${kept.map(({ load }) => load.toFixed(0)).join(", ")}; bytes min+gzip\n`,
	);
	console.log(
		"| variant | ro | ru | en | bytes (ru) | ru, × grai's (interval) |",
	);
	console.log("|---|---|---|---|---|---|");
	const recorded = [];
	for (const name of names) {
		const each = (figure) =>
			Object.fromEntries(LOCALES.map((locale) => [locale, figure(locale)]));
		const ns = each((locale) => median(byRound(name, locale)));
		const ratio = each((locale) =>
			pairedRatio(byRound(name, locale), byRound(emittedName, locale)),
		);
		const source = variantSources("ru")[name];
		const bytes =
			name === emittedName
				? await emittedBytes(pluralsFile, "ru")
				: source
					? gzipped(source)
					: "registry";
		console.log(
			`| ${name} | ${formatNs(ns.ro)} | ${formatNs(ns.ru)} | ${formatNs(ns.en)} | ${bytes} | ${ratioText(ratio.ru)} |`,
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
	recordResults("plurals", recorded, {
		counts: integers.length,
		samplesPerRound: SAMPLES,
		reference: emittedName,
		rounds: roundsRecord(kept),
	});
}
