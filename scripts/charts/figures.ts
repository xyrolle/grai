// The README's charts, each from the results a bench recorded (bench/results.mjs): what it shows,
// the sentence its alt text states, and a table of the same numbers, as an image has no hover.

import { readdirSync, readFileSync } from "node:fs";
import type { Bar, BarChart } from "./bars.ts";

/** A chart, its file's name, and what its alt text says it finds. */
export type Figure = { id: string; chart: BarChart; alt: string };

/** A README section's charts, what they find in a sentence drawn from the numbers, and their table. */
export type Section = {
	id: string;
	lead?: string;
	figures: Figure[];
	table: string[][];
	note: string;
};

const results = new URL("../../bench/results/", import.meta.url);
const read = (name: string) =>
	JSON.parse(readFileSync(new URL(`${name}.json`, results), "utf8"));

const whole = (value: number) => Math.round(value).toLocaleString("en");
const tenths = (value: number) =>
	value.toLocaleString("en", {
		maximumFractionDigits: 1,
		minimumFractionDigits: 1,
	});
const seconds = (ms: number) =>
	`${(ms / 1000).toLocaleString("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} s`;

/** Bars sorted low to high, as every chart here is lower-is-better. */
const sorted = (bars: Bar[]) => bars.toSorted((a, b) => a.value - b.value);

/** "grai in 21 ns, Paraglide in 48 ns and i18next in 1,500 ns", in the bars' order. */
function listed(bars: Bar[]): string {
	const each = bars.map(({ label, shown }) => `${label} ${shown}`);
	return each.length < 2
		? each.join("")
		: `${each.slice(0, -1).join(", ")} and ${each.at(-1)}`;
}

type ServerRow = {
	variant: string;
	locale: string;
	ns: Record<string, number | undefined>;
};

const kinds = ["text", "inputs", "plural", "markup"] as const;
type Kind = (typeof kinds)[number];

/** "a", "a and b", "a, b and c". */
function and(words: string[]): string {
	return words.length < 2
		? words.join("")
		: `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

function serverSection(): Section {
	const { rows, versions, calls, mix } = read("server-synthetic");
	const locales: string[] = [
		...new Set(rows.map((row: ServerRow) => row.locale)),
	] as string[];
	const locale = locales.at(-1) ?? "";
	const of = (variant: string, at = locale) =>
		rows.find((row: ServerRow) => row.locale === at && row.variant === variant)
			.ns;
	const graiCall = "grai `m.key()`";
	const paraglideCall = "Paraglide `m.key()`";
	const graiGiven = "grai `m.key(i, { locale })`";
	const paraglideGiven = "Paraglide `m.key(i, { locale })`";
	const libraries: [string, string][] = [
		["grai", graiCall],
		["Paraglide", paraglideCall],
		["i18next", "i18next `t(key, values)`"],
		["use-intl", "use-intl `t(key, values)`, `t.markup`"],
	];
	const given: [string, string][] = [
		["grai, given `{ locale }`", graiGiven],
		["Paraglide, given `{ locale }`", paraglideGiven],
	];
	const bars = sorted(
		libraries.map(([label, variant]) => {
			const ns = of(variant).page ?? 0;
			return {
				label,
				value: ns,
				shown: `${whole(ns)} ns`,
				grai: label === "grai",
			};
		}),
	);
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
		`In a page's mix of ${whole(calls)} calls, grai takes ${whole(of(graiCall).page ?? 0)} ns a call against Paraglide's ${whole(of(paraglideCall).page ?? 0)} ns.`,
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
	return {
		id: "server",
		lead,
		figures: [
			{
				id: "server-page",
				chart: {
					title,
					subtitle:
						"Nanoseconds a call, in the page's mix of kinds; lower is better",
					axis: "nanoseconds a call",
					groups: [{ bars }],
				},
				alt: `${title}: ${listed(bars)} a call.`,
			},
		],
		table: [
			["", "locale", "page's mix", ...kinds],
			...locales.flatMap((at) =>
				[...libraries, ...given].map(([label, variant]) => {
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
			Object.entries(mix as Record<Kind, number>).map(
				([kind, count]) => `${whole(count)} ${kind}`,
			),
		)} calls, each made as an app makes it, a message with markup called for its text; the markup column draws its parts, which i18next has none of. Paraglide ${versions["@inlang/paraglide-js"]}, i18next ${versions.i18next}, use-intl ${versions["use-intl"]}.`,
	};
}

type HydrateRow = {
	variant: string;
	locale: string;
	slowdown: number;
	bytes: { brotli: number; raw: number };
	ms: {
		starts: number;
		evaluates: number;
		hydrates: number;
		hydratedAt: number;
		mounts: number;
	};
};

function pageSection(): Section {
	const { rows, calls } = read("hydrate-synthetic");
	const locale = rows.at(-1).locale;
	const of = (variant: string): HydrateRow =>
		rows.find(
			(row: HydrateRow) =>
				row.locale === locale && row.slowdown === 1 && row.variant === variant,
		);
	const libraries: [string, string][] = [
		["grai", "grai, the locale's copies"],
		["Paraglide", "Paraglide"],
		["i18next", "i18next"],
		["use-intl", "use-intl"],
	];
	const bars = sorted(
		libraries.map(([label, variant]) => {
			const kb = of(variant).bytes.brotli / 1024;
			return {
				label,
				value: kb,
				shown: `${tenths(kb)} KB`,
				grai: label === "grai",
			};
		}),
	);
	const title = `A page of ${whole(calls)} messages: its JS`;
	return {
		id: "page",
		figures: [
			{
				id: "page-js",
				chart: {
					title,
					subtitle:
						"KB brotli, the page's own code and its messages included; lower is better",
					axis: "KB, brotli",
					groups: [{ bars }],
				},
				alt: `${title}: ${listed(bars)}.`,
			},
		],
		table: [
			["", "JS, KB brotli", "JS, KB", "hydrates, ms"],
			...libraries.map(([label, variant]) => {
				const row = of(variant);
				return [
					label,
					tenths(row.bytes.brotli / 1024),
					whole(row.bytes.raw / 1024),
					tenths(row.ms.hydrates),
				];
			}),
		],
		note: `One Svelte page, server-rendered and hydrated in Chromium, in \`${locale}\` (\`bench/hydrate.mjs\`). grai's row loads its locale's copies of the message chunks, as \`grai/sveltekit\` serves them.`,
	};
}

type Added = {
	build: number;
	added: number;
	compile: number;
	rest: number;
	hooks: { hook: string; ms: number }[][];
	runs: { builds: number[] };
};
type BuildRow = {
	keys: number;
	calls: number;
	stub: { build: number };
	grai: Added;
	paraglide: Added;
};

function buildSection(): Section {
	const { rows, versions, runs } = read("build-added");
	const libraries: [string, "grai" | "paraglide"][] = [
		["grai", "grai"],
		["Paraglide", "paraglide"],
	];
	const groups = rows.map((row: BuildRow) => ({
		heading: `${whole(row.keys)} keys`,
		bars: sorted(
			libraries.map(([label, key]) => ({
				label,
				value: row[key].added / 1000,
				shown: seconds(row[key].added),
				grai: key === "grai",
			})),
		),
	}));
	/** The hooks Rolldown named in the build whose time is the median, the one the table shows. */
	const named = (each: Added) => {
		const hooks = each.hooks[each.runs.builds.indexOf(each.build)] ?? [];
		return hooks.length === 0
			? "none of 1 s or more"
			: hooks.map(({ hook, ms }) => `${hook} ${seconds(ms)}`).join(", ");
	};
	const capped = rows.flatMap((row: BuildRow) =>
		libraries
			.filter(([, key]) => row[key].compile > row[key].added)
			.map(([label]) => `${label}'s compile at ${whole(row.keys)} keys`),
	);
	const title = "Time i18n adds to a production build";
	return {
		id: "build",
		figures: [
			{
				id: "build-added",
				chart: {
					title,
					subtitle:
						"Seconds beyond the same app's build without i18n; lower is better",
					axis: "seconds",
					groups,
				},
				alt: `${title}: ${rows.map((row: BuildRow, index: number) => `at ${whole(row.keys)} keys, ${listed(groups[index].bars)}`).join("; ")}.`,
			},
		],
		table: [
			["", "keys", "added", "its compile", "the rest", "hooks Rolldown names"],
			...rows.flatMap((row: BuildRow) =>
				libraries.map(([label, key]) => {
					const each = row[key];
					return [
						label,
						whole(row.keys),
						seconds(each.added),
						seconds(Math.min(each.compile, each.added)),
						seconds(Math.max(each.rest, 0)),
						named(each),
					];
				}),
			),
		],
		note: `Vite ${versions.vite} (Rolldown ${versions.rolldown}) builds one app of 64 pages that call every key of the synthetic catalog, on grai, on Paraglide ${versions["@inlang/paraglide-js"]} and with the words written in, each build from a clean checkout in a new process, the three taking turns, medians of ${runs} (\`bench/build-added.mjs\`). Added is the build less the build without i18n. Its compile is the library's own, catalogs to output, timed alone, which both plugins run in \`buildStart\`; the rest is the plugin's other work and Rolldown's on the message modules. Rolldown times the plugins' hooks itself, and names a hook of a second or more; the table gives those of the median build.${capped.length > 0 ? ` ${and(capped)} took longer alone than all the library adds to the build, as the runs' spread allows, so the table gives it as the whole addition and the rest as none.` : ""}`,
	};
}

type HmrRow = { design: string; editToPage?: number };

function devSection(): Section {
	const { rows, chromium, edits } = read("hmr-synthetic");
	const of = (design: string): HmrRow =>
		rows.find((row: HmrRow) => row.design === design);
	const libraries: [string, string][] = [
		["grai", "grai's plugin"],
		["Paraglide", "paraglide"],
		["i18next", "i18next"],
		["use-intl", "use-intl"],
	];
	const bars = sorted(
		libraries.map(([label, design]) => {
			const ms = of(design).editToPage ?? 0;
			return {
				label,
				value: ms,
				shown: `${whole(ms)} ms`,
				grai: label === "grai",
			};
		}),
	);
	const title = "One message edited, until the page shows it";
	return {
		id: "dev",
		figures: [
			{
				id: "dev-edit",
				chart: {
					title,
					subtitle: "Milliseconds in Vite's dev server; lower is better",
					axis: "milliseconds",
					groups: [{ bars }],
				},
				alt: `${title}: ${listed(bars)}.`,
			},
		],
		table: [
			["", "edit to page, ms"],
			...libraries.map(([label, design]) => [
				label,
				tenths(of(design).editToPage ?? 0),
			]),
		],
		note: `A catalog saved until Chromium ${chromium} shows the edit, medians of ${edits} edits (\`bench/hmr.mjs\`). grai patches the open page in place; Paraglide's plugin compiles again, and i18next and use-intl send the locale's catalog again.`,
	};
}

type Cold = { ready: number; page: number };

function nextSection(): Section {
	const { rows, versions, keys, locale } = read("nextjs-synthetic");
	const libraries: [string, string][] = [
		["grai", "grai"],
		["next-intl", "next-intl"],
	];
	const bars = sorted(
		libraries.map(([label, app]) => {
			const cold: Cold = rows.cold[app];
			return {
				label,
				value: cold.page,
				shown: `${whole(cold.page)} ms`,
				grai: label === "grai",
			};
		}),
	);
	const downloads: [string, string][] = [
		...libraries,
		["next-intl, client keys picked", "next-intl, client keys picked"],
	];
	const title = "Next.js: the first page of a cold next dev";
	const grai: Cold & { runs: Cold[] } = rows.cold.grai;
	const nextIntl: Cold & { runs: Cold[] } = rows.cold["next-intl"];
	const behind = grai.page > nextIntl.page;
	const spread = ({ runs }: { runs: Cold[] }) =>
		`${whole(Math.min(...runs.map((run) => run.page)))}–${whole(Math.max(...runs.map((run) => run.page)))}`;
	return {
		id: "next",
		lead: `grai is ${behind ? "behind" : "not behind"} here: in rounds the two apps took in turn, its first page came in a median of ${whole(grai.page)} ms against next-intl's ${whole(nextIntl.page)} ms, the rounds ranging over ${spread(grai)} and ${spread(nextIntl)} ms. Turbopack compiles grai's message functions in each layer that imports them, where next-intl's catalog is data. A built Next.js page is smaller on grai ([docs/runtime.md](docs/runtime.md#nextjs)).`,
		figures: [
			{
				id: "next-first-page",
				chart: {
					title,
					subtitle:
						"Milliseconds until the page's first response, from an empty .next; lower is better",
					axis: "milliseconds",
					groups: [{ bars }],
				},
				alt: `${title}: ${listed(bars)}.${behind ? " grai is behind here." : ""}`,
			},
		],
		table: [
			["", "ready, ms", "first page, ms", "page download, KB brotli"],
			...downloads.map(([label, app]) => {
				const cold: Cold | undefined = rows.cold[app];
				const { document, script, other } = rows.bytes[app];
				return [
					label,
					cold === undefined ? "—" : whole(cold.ready),
					cold === undefined ? "—" : whole(cold.page),
					tenths((document + script + other) / 1024),
				];
			}),
		],
		note: `Next ${versions.next} with Turbopack, next-intl ${versions["next-intl"]}, a page of ${whole(keys.server)} messages in a server component and ${whole(keys.client)} in a client one, in \`${locale}\`; the apps take turns, medians of ${rows.cold.grai.runs.length} (\`bench/nextjs.mjs\`). The last row picks the client component's keys, as next-intl's docs advise; only its download was measured.`,
	};
}

type Timed = { cold: number; warm: number };

function checkSection(): Section {
	const { rows, runs } = read("refactor-synthetic");
	const commands: [string, string][] = [
		["check", "check"],
		["check --fix", "check --fix"],
		["find", "find"],
		["rename", "rename"],
	];
	const groups = commands.map(([label, command]) => {
		const timed: Timed = rows[command];
		return {
			heading: `grai ${label}`,
			bars: [
				{
					label: "nothing kept",
					value: timed.cold / 1000,
					shown: seconds(timed.cold),
					grai: true,
				},
				{
					label: "facts kept",
					value: timed.warm / 1000,
					shown: seconds(timed.warm),
					grai: true,
				},
			],
		};
	});
	const title = "grai's commands on 13,000 keys and 9,000 files";
	return {
		id: "check",
		figures: [
			{
				id: "check",
				chart: {
					title,
					subtitle:
						"Seconds, with no facts kept and with the last run's; lower is better",
					axis: "seconds",
					groups,
				},
				alt: `${title}: ${groups.map(({ heading, bars }) => `${heading}, ${listed(bars)}`).join("; ")}.`,
			},
		],
		table: [
			["", "nothing kept", "facts kept"],
			...commands.map(([label, command]) => [
				label,
				seconds(rows[command].cold),
				seconds(rows[command].warm),
			]),
		],
		note: `Each command in a new Node process, on a synthetic project of 13,000 keys in three locales and 9,000 source files, medians of ${runs} (\`bench/refactor.mjs\`). A cold check parses each file whose text may read messages and resolves its imports, which is what makes its reads exact; CI keeps the facts between runs.`,
	};
}

/** Every section of the README's charts. */
export function sections(): Section[] {
	return [
		pageSection(),
		serverSection(),
		buildSection(),
		devSection(),
		nextSection(),
		checkSection(),
	];
}

/** The numbers the README's text cites, by name, each from the results it was measured in. */
export function cited(): Record<string, string> {
	const library = read("library-bytes-synthetic").rows;
	const runtime = (name: string) => {
		const row = library.find(
			(each: { library: string }) => each.library === name,
		);
		return `${tenths(row.runtime.brotli / 1024)} KB`;
	};
	const page = pageSection().figures[0]?.chart.groups[0]?.bars ?? [];
	const dev = devSection().figures[0]?.chart.groups[0]?.bars ?? [];
	const shown = (bars: Bar[], label: string) =>
		bars.find((each) => each.label === label)?.shown ?? "";
	const refactor = read("refactor-synthetic").rows;
	const server = read("server-synthetic").rows;
	const plural = (variant: string) =>
		`${whole(server.findLast((row: ServerRow) => row.variant === variant).ns.plural)} ns`;
	const { date, machine } = read("build-added");
	const loads = readdirSync(results)
		.filter((file) => file.endsWith(".json"))
		.flatMap((file) => {
			const { load } = read(file.slice(0, -".json".length));
			return [load.start, load.end];
		});
	return {
		"bench-date": new Date(date).toLocaleDateString("en-GB", {
			day: "numeric",
			month: "short",
			year: "numeric",
		}),
		"bench-machine": `${machine.cpu === "unknown" ? "a machine" : `an ${machine.cpu}`} with ${machine.cores} cores`,
		"bench-load": `${whole(Math.min(...loads))} to ${whole(Math.max(...loads))}`,
		"runtime-grai": runtime("grai, as its build writes the locale's copies"),
		"runtime-paraglide": runtime("Paraglide, every locale"),
		"runtime-i18next": runtime("i18next"),
		"runtime-use-intl": runtime("use-intl"),
		"page-grai": shown(page, "grai"),
		"page-paraglide": shown(page, "Paraglide"),
		"page-i18next": shown(page, "i18next"),
		"dev-grai": shown(dev, "grai"),
		"dev-paraglide": shown(dev, "Paraglide"),
		"plural-grai": plural("grai `m.key()`"),
		"plural-paraglide": plural("Paraglide `m.key()`"),
		"check-warm": seconds(refactor.check.warm),
		"check-cold": seconds(refactor.check.cold),
	};
}
