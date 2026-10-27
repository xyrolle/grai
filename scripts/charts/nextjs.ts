// The charts of Next.js in development, against next-intl: a cold `next dev`'s first page, where
// grai is not ahead, and one message edited until the page shows it.

import {
	barsOf,
	duration,
	found,
	glanceOf,
	read,
	type Section,
	tenths,
	whole,
} from "./results.ts";

type Cold = { ready: number; page: number };
type Edit = { shown: number; written?: number };

const apps: [string, string][] = [
	["grai", "grai"],
	["next-intl", "next-intl"],
];

/** The Next.js bench's page, as its note says what it holds. */
function described(): string {
	const { versions, keys, locale } = read("nextjs-synthetic");
	return `Next ${versions.next} with Turbopack, next-intl ${versions["next-intl"]}, a page of ${whole(keys.server)} messages in a server component and ${whole(keys.client)} in a client one, in \`${locale}\``;
}

export function nextColdSection(): Section {
	const { rows } = read("nextjs-synthetic");
	const entries = apps.map(([label, app]): [string, number] => [
		label,
		(rows.cold[app] as Cold).page,
	]);
	const groups = [{ bars: barsOf(entries, (ms) => ms, duration) }];
	const downloads: [string, string][] = [
		...apps,
		["next-intl, client keys picked", "next-intl, client keys picked"],
	];
	const title = "Next.js: the first page of a cold next dev";
	const grai: Cold & { runs: Cold[] } = rows.cold.grai;
	const nextIntl: Cold & { runs: Cold[] } = rows.cold["next-intl"];
	const behind = grai.page > nextIntl.page;
	const spread = ({ runs }: { runs: Cold[] }) =>
		`${whole(Math.min(...runs.map((run) => run.page)))}–${whole(Math.max(...runs.map((run) => run.page)))}`;
	return {
		id: "next-cold",
		heading: "Next.js: a cold dev server's first page",
		readme: true,
		lead: `grai is ${behind ? "behind" : "not behind"} here: in rounds the two apps took in turn, its first page came in a median of ${whole(grai.page)} ms against next-intl's ${whole(nextIntl.page)} ms, the rounds ranging over ${spread(grai)} and ${spread(nextIntl)} ms. Turbopack compiles grai's message functions in each layer that imports them, where next-intl's catalog is data. A built Next.js page is smaller on grai ([docs/runtime.md](docs/runtime.md#nextjs)).`,
		figures: [
			{
				id: "next-first-page",
				chart: {
					title,
					subtitle:
						"Milliseconds until the page's first response, from an empty .next; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: `${found(title, groups)}${behind ? " grai is behind here." : ""}`,
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
		note: `${described()}; the apps take turns, medians of ${grai.runs.length} (\`bench/nextjs.mjs\`). The last row picks the client component's keys, as next-intl's docs advise; only its download was measured.`,
		glance: [
			glanceOf("Next.js dev: a cold start's first page", entries, duration),
		],
	};
}

export function nextEditSection(): Section {
	const { rows, chromium, edits } = read("nextjs-synthetic");
	const components: [string, "server" | "client"][] = [
		["A server component", "server"],
		["A client component", "client"],
	];
	const entries = (component: "server" | "client"): [string, number][] =>
		apps.map(([label, app]) => [
			label,
			(rows.dev[app].edits[component] as Edit).shown,
		]);
	const groups = components.map(([heading, component]) => ({
		heading,
		bars: barsOf(entries(component), (ms) => ms, duration),
	}));
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
					subtitle: "Milliseconds in next dev; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "server component, ms", "client component, ms"],
			...apps.map(([label, app]) => {
				const shown = (edit: Edit) =>
					edit.written === undefined
						? whole(edit.shown)
						: `${whole(edit.shown)} (written in ${tenths(edit.written)})`;
				return [
					label,
					shown(rows.dev[app].edits.server),
					shown(rows.dev[app].edits.client),
				];
			}),
		],
		note: `${described()}. A catalog saved until Chromium ${chromium} shows the edit in the open page, medians of ${edits} edits (\`bench/nextjs.mjs\`). In grai's row, the time it took grai to write the edit is in brackets; the rest is Next's.`,
		glance: components.map(([heading, component]) =>
			glanceOf(
				`Next.js dev: an edit in ${heading.toLowerCase()}, until shown`,
				entries(component),
				duration,
			),
		),
	};
}
