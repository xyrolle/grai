// The charts of what a message costs where it runs: a call on a server, a server render, a plural
// or an ordinal chosen, what a page downloads and how long it hydrates, and the runtime a page
// needs.

import {
	and,
	barsOf,
	best,
	between,
	found,
	glanceOf,
	type Interval,
	kilobytes,
	milliseconds,
	nanoseconds,
	read,
	type Section,
	spread,
	times,
	whole,
} from "./results.ts";

const kinds = ["text", "inputs", "plural", "markup"] as const;
type Kind = (typeof kinds)[number] | "page";

type ServerRow = {
	variant: string;
	locale: string;
	ratio: Partial<Record<Kind, Interval>>;
	rounds: Partial<Record<Kind, number[]>>;
};

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

/** How a ratio's interval reads beside 1: theirs over grai's. */
const side = (ratio: Interval) =>
	ratio.low > 1 ? "ahead" : ratio.high < 1 ? "behind" : "level";

/** A ratio with its interval, as a table cell writes it: "2.2× (1.9× to 2.6×)". */
const ratioCell = (ratio: Interval | undefined) =>
	ratio === undefined
		? "—"
		: `${times(ratio.median)} (${between(ratio, times)})`;

export function serverSection(): Section {
	const { rows, calls, mix, versions } = read("server-synthetic");
	const locales: string[] = [
		...new Set<string>(rows.map((row: ServerRow) => row.locale)),
	];
	const locale = locales.at(-1) ?? "";
	const of = (variant: string, at = locale): ServerRow => {
		const row = rows.find(
			(each: ServerRow) => each.locale === at && each.variant === variant,
		);
		if (row === undefined) throw new Error(`server has no ${variant} in ${at}`);
		return row;
	};
	const figure = (variant: string, kind: Kind, at = locale): Interval =>
		spread(of(variant, at).rounds[kind] ?? []);
	const entries = callers.map(([label, variant]): [string, Interval] => [
		label,
		figure(variant, "page"),
	]);
	const groups = [{ bars: barsOf(entries, (ns) => ns, nanoseconds) }];
	/** Each kind's side in every locale: ahead, behind or level, where they all agree. */
	const sides = (variant: string) =>
		kinds.map((kind) => {
			const each = locales.map((at) => {
				const ratio = of(variant, at).ratio[kind];
				return ratio === undefined ? "level" : side(ratio);
			});
			return { kind, side: new Set(each).size === 1 ? each[0] : "mixed" };
		});
	const named: Record<(typeof kinds)[number], string> = {
		text: "plain text",
		inputs: "messages with inputs",
		plural: "plurals",
		markup: "markup",
	};
	const said = (
		list: { kind: (typeof kinds)[number]; side: string | undefined }[],
		wanted: string,
	) =>
		and(
			list
				.filter((each) => each.side === wanted)
				.map((each) => named[each.kind]),
		);
	const sentence = (variant: string, who: string) => {
		const list = sides(variant);
		return [
			said(list, "ahead") && `${who} grai is ahead on ${said(list, "ahead")}`,
			said(list, "level") && `level on ${said(list, "level")}`,
			said(list, "behind") && `behind on ${said(list, "behind")}`,
			said(list, "mixed") &&
				`ahead in one locale and not the other on ${said(list, "mixed")}`,
		]
			.filter(Boolean)
			.join("; ");
	};
	const pageRatio = of(paraglideCall).ratio.page;
	if (pageRatio === undefined) throw new Error("server has no page ratio");
	const title = `A page's ${whole(calls)} message calls on a server`;
	return {
		id: "server",
		heading: "A message call on a server",
		readme: true,
		lead: `Kind by kind against Paraglide, in ${and(locales.map((each) => `\`${each}\``))}, each ratio's interval taken from rounds: ${sentence(paraglideCall, "as an app calls them,")}. ${sentence(paraglideGiven, "With each call given its locale,")}.`,
		figures: [
			{
				id: "server-page",
				chart: {
					title,
					subtitle:
						"Nanoseconds a call: the page's mix, warm in-request batch average; lower is better",
					axis: "nanoseconds a call",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			[
				"",
				"locale",
				"page's mix, ns",
				...kinds.map((kind) => `${kind}, theirs over grai's`),
			],
			...locales.flatMap((at) =>
				[
					...callers,
					["Paraglide, given `{ locale }`", paraglideGiven],
					["grai, given `{ locale }`", graiGiven],
				].map(([label = "", variant = ""]) => [
					label,
					at,
					whole(figure(variant, "page", at).median),
					...kinds.map((kind) =>
						variant === graiCall || variant === graiGiven
							? ""
							: ratioCell(of(variant, at).ratio[kind]),
					),
				]),
			),
		],
		note: `Each variant makes the same ${whole(calls)} calls inside a request in Node, built as an app's server build has them with its library's own plugins, its text checked against Paraglide's (\`bench/server.mjs\`). The clock is a warm batch inside one request: each run of the calls, divided by their number, after a warm-up. The page's mix is ${and(
			Object.entries(mix as Record<string, number>).map(
				([kind, count]) => `${whole(count)} ${kind}`,
			),
		)} calls. Each variant runs in a process of its own once a round, in an order that rotates; a ratio is the variant's calls over grai's of the same shape in the same round, given \`{ locale }\` against grai given it too. i18next draws no markup parts. Paraglide ${versions["@inlang/paraglide-js"]}, i18next ${versions.i18next}, use-intl ${versions["use-intl"]}.`,
		glance: [
			glanceOf(
				"Server: a message call, the page's mix, warm",
				figure(graiCall, "page"),
				["Paraglide", figure(paraglideCall, "page")],
				nanoseconds,
				{ kind: "ratio", ratio: pageRatio },
			),
		],
	};
}

type SsrRow = {
	variant: string;
	locale: string;
	ratio: Interval;
	rounds: number[];
};

export function ssrSection(): Section {
	const { rows, calls, versions } = read("ssr-synthetic");
	const locales: string[] = [
		...new Set<string>(rows.map((row: SsrRow) => row.locale)),
	];
	const locale = locales.at(-1) ?? "";
	const of = (variant: string, at = locale): SsrRow => {
		const row = rows.find(
			(each: SsrRow) => each.locale === at && each.variant === variant,
		);
		if (row === undefined) throw new Error(`ssr has no ${variant} in ${at}`);
		return row;
	};
	const rendered = (variant: string, at = locale): Interval =>
		spread(of(variant, at).rounds.map((ns) => ns / 1e6));
	const libraries = ["grai", "Paraglide", "i18next", "use-intl"];
	const inlined = "prototype, inlined into the template";
	const entries = libraries.map((label): [string, Interval] => [
		label,
		rendered(label),
	]);
	const groups = [{ bars: barsOf(entries, (ms) => ms, milliseconds) }];
	const [name, figure] = best(entries);
	const title = `A warm server render of a page of ${whole(calls)} message calls`;
	return {
		id: "ssr",
		heading: "A server render",
		readme: true,
		figures: [
			{
				id: "ssr",
				chart: {
					title,
					subtitle:
						`Milliseconds a render, in Svelte on Node, in \`${locale}\`; lower is better`.replaceAll(
							"`",
							"",
						),
					axis: "milliseconds a render",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			[
				"",
				...locales.flatMap((at) => [`${at}, ms`, `${at}, theirs over grai's`]),
			],
			...[...libraries, inlined].map((label) => [
				label === inlined ? "the words written into the page" : label,
				...locales.flatMap((at) => [
					milliseconds(rendered(label, at).median),
					label === "grai" ? "" : ratioCell(of(label, at).ratio),
				]),
			]),
		],
		note: `Svelte renders one page of ${whole(calls)} message calls inside a request already open, as an app built with Vite renders it, its messages from each library built with its own plugins (\`bench/ssr.mjs\`). The clock is a warm render, \`render(Page, { props })\` after a warm-up; compiling, imports, the libraries' setup and the middleware are outside it. Each variant renders in a process of its own once a round, in an order that rotates; medians of the rounds with the interval that holds each, and each variant's ratio to grai's in the same round. The last row writes each message without a selector into the template. Paraglide ${versions["@inlang/paraglide-js"]}, i18next ${versions.i18next}, use-intl ${versions["use-intl"]}.`,
		glance: [
			glanceOf(
				`Server render, ${whole(calls)} message calls, warm, \`${locale}\``,
				rendered("grai"),
				[name, figure],
				milliseconds,
				{ kind: "ratio", ratio: of(name).ratio },
			),
		],
	};
}

type SelectionRow = {
	variant: string;
	ratio: Record<string, Interval>;
	rounds: Record<string, number[]>;
};

/** A section of the plural or ordinal benches, which choose a form for 0 to 999. */
function selectionSection(
	bench: "plurals" | "ordinals",
	variants: [string, string][],
): Section {
	const { rows, versions, counts, reference } = read(bench);
	const locale = "ru";
	const of = (variant: string): SelectionRow => {
		const row = rows.find((each: SelectionRow) => each.variant === variant);
		if (row === undefined) throw new Error(`${bench} has no ${variant}`);
		return row;
	};
	const chosen = (variant: string, at = locale): Interval =>
		spread(of(variant).rounds[at] ?? []);
	const locales = Object.keys(of(reference).rounds);
	const entries = variants.map(([label, variant]): [string, Interval] => [
		label,
		chosen(variant),
	]);
	const groups = [{ bars: barsOf(entries, (ns) => ns, nanoseconds) }];
	const noun = bench === "plurals" ? "a plural" : "an ordinal";
	const title = `Choosing ${noun} form in ${locale}`;
	const paraglide =
		variants.find(([label]) => label === "Paraglide")?.[1] ?? "";
	const ratio = of(paraglide).ratio[locale];
	if (ratio === undefined)
		throw new Error(`${bench} has no ratio in ${locale}`);
	return {
		id: bench,
		heading: bench === "plurals" ? "Choosing a plural" : "Choosing an ordinal",
		readme: false,
		figures: [
			{
				id: bench,
				chart: {
					title,
					subtitle: `Nanoseconds a choice, for each count from 0 to ${whole(counts - 1)}; lower is better`,
					axis: "nanoseconds a choice",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			[
				"",
				...locales.flatMap((at) => [`${at}, ns`, `${at}, theirs over grai's`]),
			],
			...variants.map(([label, variant]) => [
				label,
				...locales.flatMap((at) => [
					nanoseconds(chosen(variant, at).median),
					variant === reference ? "" : ratioCell(of(variant).ratio[at]),
				]),
			]),
		],
		note: `Each way of choosing ${noun} form is checked against \`Intl.PluralRules\` on 0 to 10,000 and on fractions, then timed on 0 to ${whole(counts - 1)} in Node, in a process of its own once a round, in an order that rotates (\`bench/${bench}.mjs\`). grai's rule is the one its compiler writes; Paraglide ${versions["@inlang/paraglide-js"]}'s is its \`registry.plural\`; a cached \`Intl.PluralRules\` is what a library that calls Intl at best does.`,
		glance: [
			glanceOf(
				`${noun === "a plural" ? "A plural" : "An ordinal"} form chosen, \`${locale}\``,
				chosen(reference),
				["Paraglide", chosen(paraglide)],
				nanoseconds,
				{ kind: "ratio", ratio },
			),
		],
	};
}

export const pluralsSection = (): Section =>
	selectionSection("plurals", [
		["grai", "grai's rules, as plurals.js has them"],
		["Paraglide", "Paraglide registry.plural"],
		["Intl.PluralRules, cached", "Intl.PluralRules cached per locale"],
	]);

export const ordinalsSection = (): Section =>
	selectionSection("ordinals", [
		["grai", "grai, compiled"],
		["Paraglide", "Paraglide registry.plural"],
		["Intl.PluralRules, cached", "Intl.PluralRules cached per locale"],
	]);

type HydrateRow = {
	variant: string;
	locale: string;
	slowdown: number;
	bytes: { brotli: number; raw: number };
	ratio: { hydrates: Interval };
	loads: { evaluated: number; hydrated: number }[];
};

/** The page's variants: grai's, and each other library in the setup its docs advise, then the rest. */
const recommended: [string, string][] = [
	["grai", "grai, the locale's copies"],
	["Paraglide", "Paraglide"],
	["i18next, page's keys", "i18next"],
	["use-intl, page's keys", "use-intl"],
];
const others: [string, string][] = [
	["i18next, whole catalog", "i18next, the locale's whole catalog"],
	["use-intl, whole catalog", "use-intl, the locale's whole catalog"],
];

/** The hydrate bench's page in its last locale, unthrottled, by variant. */
function hydrated() {
	const recorded = read("hydrate-synthetic");
	const locale: string = recorded.rows.at(-1).locale;
	const of = (variant: string): HydrateRow => {
		const row = recorded.rows.find(
			(each: HydrateRow) =>
				each.locale === locale &&
				each.slowdown === 1 &&
				each.variant === variant,
		);
		if (row === undefined) throw new Error(`hydrate has no ${variant}`);
		return row;
	};
	return {
		calls: recorded.calls as number,
		keys: recorded.keys as number,
		runs: recorded.runs as number,
		chromium: recorded.chromium as string,
		locale,
		of,
	};
}

export function pageSection(): Section {
	const { calls, keys, locale, of } = hydrated();
	const entries = (list: [string, string][]) =>
		list.map(([label, variant]): [string, number] => [
			label,
			of(variant).bytes.brotli,
		]);
	const groups = [
		{
			bars: barsOf(
				entries([...recommended, ...others]),
				(bytes) => bytes / 1024,
				kilobytes,
			),
		},
	];
	const [name, figure] = best(entries(recommended));
	const title = `A page of ${whole(calls)} message calls, ${whole(keys)} distinct keys: its JS`;
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
						"KB brotli: every script the built page loads or holds inline, each compressed on its own; lower is better",
					axis: "KB, brotli",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "JS, KB brotli", "JS, KB"],
			...[...recommended, ...others].map(([label, variant]) => [
				label,
				(of(variant).bytes.brotli / 1024).toFixed(1),
				whole(of(variant).bytes.raw / 1024),
			]),
		],
		note: `One Svelte page built with Vite, each library's build with its own plugins, served as the build wrote it with the server's render drawn in, loaded in Chromium in \`${locale}\` (\`bench/hydrate.mjs\`). Its JS is every script it loads, each compressed on its own with brotli, and those its index.html holds inline. grai's page loads its locale's copies of the message chunks, as \`@xyrolle/grai/sveltekit\` serves them; i18next and use-intl load the page's own keys, as both advise, or the locale's whole catalog.`,
		glance: [
			glanceOf(
				`Page JS, ${whole(calls)} message calls, ${whole(keys)} distinct keys, brotli`,
				of("grai, the locale's copies").bytes.brotli,
				[name, figure],
				kilobytes,
				{ kind: "exact" },
			),
		],
	};
}

export function hydrateSection(): Section {
	const { calls, runs, chromium, locale, of } = hydrated();
	const hydration = (variant: string): Interval =>
		spread(of(variant).loads.map((load) => load.hydrated - load.evaluated));
	const entries = (list: [string, string][]) =>
		list.map(([label, variant]): [string, Interval] => [
			label,
			hydration(variant),
		]);
	const groups = [
		{
			bars: barsOf(
				entries([...recommended, ...others]),
				(ms) => ms,
				milliseconds,
			),
		},
	];
	const [name, figure] = best(entries(recommended));
	const variant = recommended.find(([label]) => label === name)?.[1] ?? name;
	const title = `Hydrating a page of ${whole(calls)} message calls`;
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
						"Milliseconds after module evaluation: props decoding + synchronous hydration; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "hydrates, ms", "theirs over grai's"],
			...[...recommended, ...others].map(([label, each]) => [
				label,
				milliseconds(hydration(each).median),
				each === "grai, the locale's copies"
					? ""
					: ratioCell(of(each).ratio.hydrates),
			]),
		],
		note: `The page of the chart above, in Chromium ${chromium}, no CPU slowdown, in \`${locale}\` (\`bench/hydrate.mjs\`): \`hydrate\` timed from when every module has been evaluated until it returns, Svelte's recovery off. Each variant loads in a browser of its own once a round, in an order that rotates, ${runs} rounds; ratios are each variant's over grai's in the same round. Its rows at a fourfold CPU slowdown are in \`bench/results/hydrate-synthetic.json\`.`,
		glance: [
			glanceOf(
				`Hydration, ${whole(calls)} message calls`,
				hydration("grai, the locale's copies"),
				[name, figure],
				milliseconds,
				{ kind: "ratio", ratio: of(variant).ratio.hydrates },
			),
		],
	};
}

type LibraryBytesRow = {
	library: string;
	runtime?: { brotli: number; raw: number };
};

export function runtimeSection(): Section {
	const { rows, locale } = read("library-bytes-synthetic");
	const of = (name: string): { brotli: number; raw: number } => {
		const runtime = rows.find(
			(row: LibraryBytesRow) => row.library === name,
		)?.runtime;
		if (runtime === undefined) throw new Error(`library-bytes has no ${name}`);
		return runtime;
	};
	const inPage: [string, string][] = [
		["grai", "grai, as its build writes the locale's copies"],
		["Paraglide", "Paraglide, every locale"],
		["i18next", "i18next"],
		["use-intl", "use-intl"],
	];
	const alone: [string, string][] = [
		["grai", "grai, runtime.js with every export, alone"],
		["Paraglide", "Paraglide, runtime.js with every export, alone"],
		["i18next", "i18next, init and t, alone"],
		["use-intl", "use-intl, createTranslator, alone"],
	];
	const entries = (list: [string, string][]) =>
		list.map(([label, name]): [string, number] => [label, of(name).brotli]);
	const groups = [
		{
			heading: "In a page that shows a text, an input and a plural",
			bars: barsOf(entries(inPage), (bytes) => bytes / 1024, kilobytes),
		},
		{
			heading: "Every export, bundled alone",
			bars: barsOf(entries(alone), (bytes) => bytes / 1024, kilobytes),
		},
	];
	const [name, figure] = best(entries(inPage));
	const title =
		"The runtime a page needs to show a text, an input and a plural";
	return {
		id: "runtime",
		heading: "The runtime",
		readme: false,
		figures: [
			{
				id: "runtime",
				chart: {
					title,
					subtitle: "KB brotli; lower is better",
					axis: "KB, brotli",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "KB brotli", "KB"],
			...[...inPage, ...alone].map(([, row]) => [
				row,
				(of(row).brotli / 1024).toFixed(1),
				(of(row).raw / 1024).toFixed(1),
			]),
		],
		note: `The runtime is what a library adds to a page that shows three messages, a plain text, a text with an input and a plural: the page's JS, built as an app's client build makes it with the library's own plugins and loaded in Chromium, less the same page's with the three texts written in (\`bench/library-bytes.mjs\`, in \`${locale}\`). Below it, the modules this figure once stood for, each bundled alone by Rolldown for the browser: grai's and Paraglide's runtime modules with every export, i18next set up with \`init\` and \`t\`, and use-intl's \`createTranslator\`.`,
		glance: [
			glanceOf(
				"Runtime a page needs to show a text, an input and a plural, brotli",
				of("grai, as its build writes the locale's copies").brotli,
				[name, figure],
				kilobytes,
				{ kind: "exact" },
			),
		],
	};
}
