// The charts of Next.js against next-intl, in both of next-intl's setups: the client component's
// keys picked, as its docs advise, and the whole catalog. A cold `next dev`'s first page, one
// message edited until the page shows it, and what a built page downloads.

import {
	barsOf,
	between,
	duration,
	found,
	glanceOf,
	type Interval,
	kilobytes,
	read,
	type Section,
	signed,
	spread,
	tenths,
	whole,
} from "./results.ts";

type Cold = { runs: { page: number }[] };
type Pair = {
	first: string;
	second: string;
	page: { values: number[] };
};
type Edit = { shown: number; written?: number; spread: Interval };

const picked = "next-intl, client keys picked";
/**
 * next-intl's two setups: its bar's label, its name in the table at a glance, and the app it is.
 */
type Setup = { label: string; name: string; app: string };
const setups: Setup[] = [
	{
		label: "next-intl, keys picked",
		name: "next-intl with the client's keys picked, as its docs advise",
		app: picked,
	},
	{
		label: "next-intl, whole catalog",
		name: "next-intl with the whole catalog",
		app: "next-intl",
	},
];
const apps: [string, string][] = [
	["grai", "grai"],
	...setups.map(({ label, app }): [string, string] => [label, app]),
];
/** What the labels say, for the notes. */
const setupsSaid =
	'"keys picked" is next-intl with the client component\'s keys picked, as its docs advise; "whole catalog" sends the client the locale\'s whole catalog, its default';

/** The Next.js bench's page, as its notes say what it holds. */
function described(): string {
	const { versions, keys, locale } = read("nextjs-synthetic");
	return `Next ${versions.next} with Turbopack, next-intl ${versions["next-intl"]}, a page of ${whole(keys.server)} messages in a server component and ${whole(keys.client)} in a client one, in \`${locale}\``;
}

/** A cell with its interval: "1,415 ms (1,339 ms to 1,450 ms)". */
const cell = (figure: Interval, write: (value: number) => string = duration) =>
	`${write(figure.median)} (${between(figure, write)})`;

export function nextColdSection(): Section {
	const { rows } = read("nextjs-synthetic");
	const cold = (app: string): Interval => {
		const figures: Cold | undefined = rows.cold[app];
		if (figures === undefined) throw new Error(`nextjs has no cold ${app}`);
		return spread(figures.runs.map((run) => run.page));
	};
	const fresh: [string, string] = ["grai, fresh clone", "grai, empty output"];
	const entries = [...apps, fresh].map(([label, app]): [string, Interval] => [
		label,
		cold(app),
	]);
	const groups = [{ bars: barsOf(entries, (ms) => ms, duration) }];
	/** grai's first page less the other's, round by round. */
	const difference = (first: string, second: string): Interval => {
		const pair = (rows.pairs as Pair[]).find(
			(each) => each.first === first && each.second === second,
		);
		if (pair === undefined)
			throw new Error(`nextjs has no pair of ${first} and ${second}`);
		return spread(pair.page.values);
	};
	const title = "Next.js: a cold next dev until the page's first response";
	return {
		id: "next-cold",
		heading: "Next.js: a cold dev server's first page",
		readme: true,
		lead: "Turbopack compiles grai's message functions in each layer that imports them, where next-intl's catalog is data. A built Next.js page is smaller on grai (in the numbers below).",
		figures: [
			{
				id: "next-first-page",
				chart: {
					title,
					subtitle:
						"Milliseconds from next dev's launch, with an empty .next, until the page's first response is complete; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			[
				"",
				"first page",
				"grai's less theirs, by round",
				"built page download, brotli",
			],
			...[...apps, fresh].map(([label, app]) => {
				const bytes = rows.bytes[app];
				return [
					label,
					cell(cold(app)),
					app === "grai" || app === fresh[1]
						? ""
						: cell(difference("grai", app), signed),
					bytes === undefined
						? "—"
						: kilobytes(bytes.document + bytes.script + bytes.other),
				];
			}),
		],
		note: `${described()}. \`next dev\` from an empty .next, from its launch until the page's first response is complete, the apps taking turns in rounds whose order rotates, ${rows.cold.grai.runs.length} rounds, each pair's difference taken in the same round (\`bench/nextjs.mjs\`). grai's app starts with the groups of keys its watch saved; the fresh clone's starts with no output at all. ${setupsSaid}. The download is each app's page after \`next build\`, every response compressed with brotli.`,
		glance: [
			...setups.map(({ name, app }) => ({
				...glanceOf(
					"Next.js dev: a cold start's first page",
					cold("grai"),
					[name, cold(app)],
					duration,
					{ kind: "difference", difference: difference("grai", app) },
				),
				together: "next cold",
			})),
			...setups.map(({ name, app }) => ({
				...glanceOf(
					"Next.js: a built page's download, brotli",
					download(rows.bytes.grai),
					[name, download(rows.bytes[app])],
					kilobytes,
					{ kind: "exact" },
				),
				together: "next download",
			})),
		],
	};
}

/** A built page's bytes: its document, scripts and the rest. */
const download = (bytes: { document: number; script: number; other: number }) =>
	bytes.document + bytes.script + bytes.other;

export function nextEditSection(): Section {
	const { rows, chromium, edits } = read("nextjs-synthetic");
	const components: [string, "server" | "client"][] = [
		["A server component", "server"],
		["A client component", "client"],
	];
	const edit = (app: string, component: "server" | "client"): Edit => {
		const figures: Edit | undefined = rows.dev[app]?.edits[component];
		if (figures === undefined)
			throw new Error(`nextjs has no ${component} edit of ${app}`);
		return figures;
	};
	const groups = components.map(([heading, component]) => ({
		heading,
		bars: barsOf(
			apps.map(([label, app]): [string, Interval] => [
				label,
				edit(app, component).spread,
			]),
			(ms) => ms,
			duration,
		),
	}));
	const ratio = (app: string, component: string): Interval => {
		const pair = rows.editPairs[`${app} over grai, ${component}`];
		if (pair === undefined)
			throw new Error(`nextjs has no edit pair of ${app}, ${component}`);
		return pair;
	};
	const title = "Next.js: one message edited, until the page shows it";
	return {
		id: "next-edit",
		heading: "Next.js: an edit in development",
		readme: false,
		figures: [
			{
				id: "next-edit",
				chart: {
					title,
					subtitle:
						"Milliseconds in next dev, from the catalog's save; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "server component", "client component"],
			...apps.map(([label, app]) => [
				label,
				...components.map(([, component]) => {
					const each = edit(app, component);
					return each.written === undefined
						? cell(each.spread)
						: `${cell(each.spread)}, written in ${tenths(each.written)} ms`;
				}),
			]),
		],
		note: `${described()}. A catalog saved as an editor saves it until Chromium ${chromium} shows the edit in the open page, ${edits} edits an app, in sessions the apps take in rotating rounds, the components' order rotating too, each page checked whole after every edit (\`bench/nextjs.mjs\`). For grai, "written" is when the file holding the edit was written; the rest is Next's. ${setupsSaid}.`,
		glance: components.flatMap(([heading, component]) =>
			setups.map(({ name, app }) => ({
				...glanceOf(
					`Next.js dev: an edit in ${heading.toLowerCase()}, until shown`,
					edit("grai", component).spread,
					[name, edit(app, component).spread],
					duration,
					{ kind: "ratio", ratio: ratio(app, component) },
				),
				together: `next edit ${component}`,
			})),
		),
	};
}
