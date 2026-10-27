// The charts of what a message costs where it runs: a call on a server, a server render, a plural
// or an ordinal chosen, what a page downloads and how long it hydrates, and the runtime's size.

import {
	and,
	barsOf,
	found,
	glanceOf,
	kilobytes,
	nanoseconds,
	read,
	type Section,
	tenths,
	whole,
} from "./results.ts";

type ServerRow = {
	variant: string;
	locale: string;
	ns: Record<string, number | undefined>;
};

const kinds = ["text", "inputs", "plural", "markup"] as const;
type Kind = (typeof kinds)[number];

const graiCall = "grai `m.key()`";
const paraglideCall = "Paraglide `m.key()`";
const graiGiven = "grai `m.key(i, { locale })`";
const paraglideGiven = "Paraglide `m.key(i, { locale })`";
const callers: [string, string][] = [
	["grai", graiCall],
	["Paraglide", paraglideCall],
	["i18next", "i18next `t(key, values)`"],
	["use-intl", "use-intl `t(key, values)`, `t.markup`"],
];

/** The server's rows, by variant and locale; the charts take the last locale measured. */
function serverRows() {
	const recorded = read("server-synthetic");
	const locales = [
		...new Set(recorded.rows.map((row: ServerRow) => row.locale)),
	] as string[];
	const locale = locales.at(-1) ?? "";
	const of = (variant: string, at = locale): ServerRow["ns"] =>
		recorded.rows.find(
			(row: ServerRow) => row.locale === at && row.variant === variant,
		).ns;
	return {
		versions: recorded.versions,
		calls: recorded.calls as number,
		mix: recorded.mix as Record<Kind, number>,
		locales,
		locale,
		of,
	};
}

export function serverSection(): Section {
	const { versions, calls, mix, locales, of } = serverRows();
	const given: [string, string][] = [
		["grai, given `{ locale }`", graiGiven],
		["Paraglide, given `{ locale }`", paraglideGiven],
	];
	const entries = callers.map(([label, variant]): [string, number] => [
		label,
		of(variant).page ?? 0,
	]);
	const bars = barsOf(entries, (ns) => ns, nanoseconds);
	/** The kinds on which grai is faster than Paraglide in every locale, slower in every one, or neither. */
	const compared = (grai: string, paraglide: string) => {
		const faster = (kind: Kind) =>
			locales.map(
				(at) => (of(grai, at)[kind] ?? 0) < (of(paraglide, at)[kind] ?? 0),
			);
		return {
			ahead: kinds.filter((kind) => faster(kind).every(Boolean)),
			behind: kinds.filter((kind) => !faster(kind).some(Boolean)),
			even: kinds.filter((kind) => new Set(faster(kind)).size > 1),
		};
	};
	const called = compared(graiCall, paraglideCall);
	const forced = compared(graiGiven, paraglideGiven);
	const named: Record<Kind, string> = {
		text: "plain text",
		inputs: "messages with inputs",
		plural: "plurals",
		markup: "markup",
	};
	const said = (list: Kind[]) => and(list.map((kind) => named[kind]));
	const lead = [
		`In a page's mix of ${whole(calls)} calls, grai takes ${nanoseconds(of(graiCall).page ?? 0)} a call against Paraglide's ${nanoseconds(of(paraglideCall).page ?? 0)}.`,
		`Measured kind by kind in ${and(locales.map((each) => `\`${each}\``))}:`,
		called.ahead.length > 0
			? `grai is ahead in each on ${said(called.ahead)}.`
			: "",
		called.behind.length > 0
			? `Paraglide is ahead in each on ${said(called.behind)}.`
			: "",
		called.even.length > 0
			? `On ${said(called.even)}, the lead changes hands from one locale to the other.`
			: "",
		forced.behind.length > 0
			? `Given each call's locale, Paraglide is ahead in each on ${said(forced.behind)}.`
			: "",
	]
		.filter(Boolean)
		.join(" ");
	const cell = (value: number | undefined) =>
		value === undefined ? "—" : whole(value);
	const title = `A page's ${whole(calls)} message calls on a server`;
	const groups = [{ bars }];
	return {
		id: "server",
		heading: "A message call on a server",
		readme: true,
		lead,
		figures: [
			{
				id: "server-page",
				chart: {
					title,
					subtitle:
						"Nanoseconds a call, in the page's mix of kinds; lower is better",
					axis: "nanoseconds a call",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "locale", "page's mix", ...kinds],
			...locales.flatMap((at) =>
				[...callers, ...given].map(([label, variant]) => {
					const ns = of(variant, at);
					return [
						label,
						at,
						cell(ns.page),
						...kinds.map((kind) => cell(ns[kind])),
					];
				}),
			),
		],
		note: `Nanoseconds a call in Node, inside a request, on the synthetic catalog (\`bench/server.mjs\`). The page's mix is ${and(
			Object.entries(mix).map(([kind, count]) => `${whole(count)} ${kind}`),
		)} calls, each made as an app makes it, a message with markup called for its text; the markup column draws its parts, which i18next has none of. Paraglide ${versions["@inlang/paraglide-js"]}, i18next ${versions.i18next}, use-intl ${versions["use-intl"]}.`,
		glance: [
			glanceOf(`Server: a message call, a page's mix`, entries, nanoseconds),
		],
	};
}

type SsrRow = { variant: string; locale: string; ns: number };

export function ssrSection(): Section {
	const { rows, calls, versions } = read("ssr-synthetic");
	const locales = [
		...new Set(rows.map((row: SsrRow) => row.locale)),
	] as string[];
	const locale = locales.at(-1) ?? "";
	const of = (variant: string, at = locale) =>
		rows.find((row: SsrRow) => row.locale === at && row.variant === variant)
			.ns / 1e6;
	const libraries = ["grai", "Paraglide", "i18next", "use-intl"];
	const inlined = "prototype, inlined into the template";
	const entries = libraries.map((label): [string, number] => [
		label,
		of(label),
	]);
	const ms = (value: number) =>
		`${value < 1 ? value.toFixed(2) : tenths(value)} ms`;
	const groups = [{ bars: barsOf(entries, (value) => value, ms) }];
	const title = `A server render of a page of ${whole(calls)} messages`;
	return {
		id: "ssr",
		heading: "A server render",
		readme: true,
		figures: [
			{
				id: "ssr",
				chart: {
					title,
					subtitle: "Milliseconds a render, in Svelte on Node; lower is better",
					axis: "milliseconds a render",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", ...locales.map((at) => `${at}, ms`)],
			...[...libraries, inlined].map((label) => [
				label === inlined ? "the words written into the page" : label,
				...locales.map((at) => ms(of(label, at))),
			]),
		],
		note: `Svelte renders one page of ${whole(calls)} message calls inside a request, its messages from each library (\`bench/ssr.mjs\`); the last row has the words written into the page, the floor of a render with no message calls. Paraglide ${versions["@inlang/paraglide-js"]}, i18next ${versions.i18next}, use-intl ${versions["use-intl"]}.`,
		glance: [glanceOf(`Server render, ${whole(calls)} messages`, entries, ms)],
	};
}

type SelectionRow = { variant: string; ns: Record<string, number> };

/** A section of the plural or ordinal benches, which choose a form for 0 to 999. */
function selectionSection(
	bench: "plurals" | "ordinals",
	variants: Record<string, string>,
): Section {
	const { rows, versions, counts } = read(bench);
	const locales = Object.keys(rows[0].ns);
	const locale = "ru";
	const of = (variant: string, at = locale): number =>
		rows.find((row: SelectionRow) => row.variant === variant).ns[at];
	const labels = Object.keys(variants);
	const entries = labels.map((label): [string, number] => [
		label,
		of(variants[label] ?? ""),
	]);
	const groups = [{ bars: barsOf(entries, (ns) => ns, nanoseconds) }];
	const noun = bench === "plurals" ? "plural" : "ordinal";
	const title = `Choosing ${noun === "plural" ? "a plural" : "an ordinal"} form in \`${locale}\``;
	const plain = title.replaceAll("`", "");
	return {
		id: bench,
		heading: noun === "plural" ? "Choosing a plural" : "Choosing an ordinal",
		readme: false,
		figures: [
			{
				id: bench,
				chart: {
					title: plain,
					subtitle: `Nanoseconds a choice, for each count from 0 to ${whole(counts - 1)}; lower is better`,
					axis: "nanoseconds a choice",
					groups,
				},
				alt: found(plain, groups),
			},
		],
		table: [
			["", ...locales.map((at) => `${at}, ns`)],
			...labels.map((label) => [
				label,
				...locales.map((at) => nanoseconds(of(variants[label] ?? "", at))),
			]),
		],
		note: `Each way of choosing ${noun === "plural" ? "a plural" : "an ordinal"} form is checked against \`Intl.PluralRules\` on 0 to 10,000 and on fractions, then timed on 0 to ${whole(counts - 1)} in Node (\`bench/${bench}.mjs\`). grai's rule is the one its compiler writes; Paraglide ${versions["@inlang/paraglide-js"]}'s is its \`registry.plural\`.`,
		glance: [
			glanceOf(
				`${noun === "plural" ? "Plural" : "Ordinal"} form chosen, \`${locale}\``,
				entries,
				nanoseconds,
			),
		],
	};
}

export const pluralsSection = (): Section =>
	selectionSection("plurals", {
		grai: "grai's rules, as plurals.js has them",
		Paraglide: "Paraglide registry.plural",
		"Intl.PluralRules, cached": "Intl.PluralRules cached per locale",
	});

export const ordinalsSection = (): Section =>
	selectionSection("ordinals", {
		grai: "grai, compiled",
		Paraglide: "Paraglide registry.plural",
		"Intl.PluralRules, cached": "Intl.PluralRules cached per locale",
	});

type HydrateRow = {
	variant: string;
	locale: string;
	slowdown: number;
	bytes: { brotli: number; raw: number };
	ms: { hydrates: number };
};

/** The hydrate bench's page in its last locale, unthrottled, by library. */
function hydrated() {
	const recorded = read("hydrate-synthetic");
	const locale = recorded.rows.at(-1).locale;
	const libraries: [string, string][] = [
		["grai", "grai, the locale's copies"],
		["Paraglide", "Paraglide"],
		["i18next", "i18next"],
		["use-intl", "use-intl"],
	];
	const of = (variant: string): HydrateRow =>
		recorded.rows.find(
			(row: HydrateRow) =>
				row.locale === locale && row.slowdown === 1 && row.variant === variant,
		);
	return {
		calls: recorded.calls as number,
		runs: recorded.runs as number,
		chromium: recorded.chromium as string,
		locale: locale as string,
		libraries,
		of,
	};
}

export function pageSection(): Section {
	const { calls, locale, libraries, of } = hydrated();
	const entries = libraries.map(([label, variant]): [string, number] => [
		label,
		of(variant).bytes.brotli,
	]);
	const groups = [
		{ bars: barsOf(entries, (bytes) => bytes / 1024, kilobytes) },
	];
	const title = `A page of ${whole(calls)} messages: its JS`;
	return {
		id: "page",
		heading: "What a page downloads",
		readme: true,
		figures: [
			{
				id: "page-js",
				chart: {
					title,
					subtitle:
						"KB brotli, the page's own code and its messages included; lower is better",
					axis: "KB, brotli",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "JS, KB brotli", "JS, KB"],
			...libraries.map(([label, variant]) => {
				const row = of(variant);
				return [
					label,
					tenths(row.bytes.brotli / 1024),
					whole(row.bytes.raw / 1024),
				];
			}),
		],
		note: `One Svelte page, server-rendered and hydrated in Chromium, in \`${locale}\` (\`bench/hydrate.mjs\`). grai's row loads its locale's copies of the message chunks, as \`grai/sveltekit\` serves them.`,
		glance: [
			glanceOf(`Page JS, ${whole(calls)} messages, brotli`, entries, kilobytes),
		],
	};
}

export function hydrateSection(): Section {
	const { calls, runs, chromium, locale, libraries, of } = hydrated();
	const entries = libraries.map(([label, variant]): [string, number] => [
		label,
		of(variant).ms.hydrates,
	]);
	const ms = (value: number) => `${tenths(value)} ms`;
	const groups = [{ bars: barsOf(entries, (value) => value, ms) }];
	const title = `Hydrating a page of ${whole(calls)} messages`;
	return {
		id: "hydrate",
		heading: "Hydrating a page",
		readme: false,
		figures: [
			{
				id: "hydrate",
				chart: {
					title,
					subtitle:
						"Milliseconds from the script's evaluation to the page hydrated; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "hydrates, ms"],
			...entries.map(([label, value]) => [label, tenths(value)]),
		],
		note: `The page of the chart above, in Chromium ${chromium}, no CPU slowdown, in \`${locale}\`; medians of ${runs} loads (\`bench/hydrate.mjs\`). Its rows at a fourfold CPU slowdown are in \`bench/results/hydrate-synthetic.json\`.`,
		glance: [glanceOf(`Hydration, ${whole(calls)} messages`, entries, ms)],
	};
}

type LibraryBytesRow = {
	library: string;
	runtime?: { brotli: number; raw: number };
};

export function runtimeSection(): Section {
	const { rows, locale } = read("library-bytes-synthetic");
	const libraries: [string, string][] = [
		["grai", "grai, as its build writes the locale's copies"],
		["Paraglide", "Paraglide, every locale"],
		["i18next", "i18next"],
		["use-intl", "use-intl"],
	];
	const of = (name: string) =>
		rows.find((row: LibraryBytesRow) => row.library === name).runtime;
	const entries = libraries.map(([label, name]): [string, number] => [
		label,
		of(name).brotli,
	]);
	const groups = [
		{ bars: barsOf(entries, (bytes) => bytes / 1024, kilobytes) },
	];
	const title = "The runtime in a page";
	return {
		id: "runtime",
		heading: "The runtime",
		readme: false,
		figures: [
			{
				id: "runtime",
				chart: {
					title,
					subtitle:
						"KB brotli, bundled and minified, messages not counted; lower is better",
					axis: "KB, brotli",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "KB brotli", "KB"],
			...libraries.map(([label, name]) => [
				label,
				tenths(of(name).brotli / 1024),
				tenths(of(name).raw / 1024),
			]),
		],
		note: `Bundled and minified by Rolldown, messages not counted (\`bench/library-bytes.mjs\`, in \`${locale}\`): grai's and Paraglide's runtime modules with every export, i18next as a page sets it up (\`i18next.init\` and \`t\`), and use-intl's \`createTranslator\`.`,
		glance: [glanceOf("Runtime in a page, brotli", entries, kilobytes)],
	};
}
