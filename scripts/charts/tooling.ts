// The charts of what a developer waits for: compiling the catalogs, again after one edit, a
// production build, an edit in the dev server and its cold start, the editor's completion of a
// key, and grai's refactoring commands.

import type { Group } from "./bars.ts";
import {
	and,
	barsOf,
	duration,
	found,
	glanceOf,
	read,
	type Section,
	seconds,
	tenths,
	whole,
} from "./results.ts";

type CompileRow = {
	keys: number;
	grai: { cold: number; noop: number; edit: number };
	paraglide: Record<string, number>;
};

const plainParaglide = "message modules, without declarations";
const typedParaglide = "message modules, with declarations";
const typedLocaleModules = "locale modules, with declarations";

/** Groups of bars, one a row: its heading the row's keys. */
const byKeys = <Row extends { keys: number }>(
	rows: Row[],
	entries: (row: Row) => [string, number][],
	axis: (value: number) => number,
	shown: (value: number) => string,
): Group[] =>
	rows.map((row) => ({
		heading: `${whole(row.keys)} keys`,
		bars: barsOf(entries(row), axis, shown),
	}));

export function compileSection(): Section {
	const { rows, runs, versions } = read("compile-time");
	const entries = (row: CompileRow): [string, number][] => [
		["grai", row.grai.cold],
		["Paraglide", row.paraglide[plainParaglide] ?? 0],
		["Paraglide, with declarations", row.paraglide[typedParaglide] ?? 0],
	];
	const groups = byKeys(rows, entries, (ms) => ms / 1000, duration);
	const largest: CompileRow = rows.at(-1);
	const title = "Compiling the catalogs";
	return {
		id: "compile",
		heading: "Compiling the catalogs",
		readme: true,
		lead: "grai's output is typed: it writes each message's declarations as it compiles. Paraglide writes its own only when asked, through TypeScript's compiler, so it is measured both ways.",
		figures: [
			{
				id: "compile",
				chart: {
					title,
					subtitle:
						"Seconds for a full compile of three locales, in a new process; lower is better",
					axis: "seconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "keys", "full compile", "nothing changed", "one message edited"],
			...rows.flatMap((row: CompileRow) => [
				[
					"grai",
					whole(row.keys),
					duration(row.grai.cold),
					duration(row.grai.noop),
					duration(row.grai.edit),
				],
				...[plainParaglide, typedParaglide, typedLocaleModules].map(
					(variant) => [
						`Paraglide, ${variant}`,
						whole(row.keys),
						duration(row.paraglide[variant] ?? 0),
						"the same",
						"the same",
					],
				),
			]),
		],
		note: `Each compile in a new Node process, timed once its modules have loaded, from no output (\`bench/compile-time.mjs\`). grai's times are medians of ${runs}, Paraglide ${versions["@inlang/paraglide-js"]}'s without declarations too, and its compiles with declarations, which go through TypeScript 6, one run each. Paraglide compiles everything again on any change.`,
		glance: [
			glanceOf(
				`Full compile, ${whole(largest.keys)} keys, both typed`,
				[
					["grai", largest.grai.cold],
					[
						"Paraglide, with declarations",
						largest.paraglide[typedParaglide] ?? 0,
					],
				],
				duration,
			),
			glanceOf(
				`Full compile, ${whole(largest.keys)} keys, Paraglide untyped`,
				[
					["grai", largest.grai.cold],
					["Paraglide", largest.paraglide[plainParaglide] ?? 0],
				],
				duration,
			),
		],
	};
}

export function editSection(): Section {
	const { rows } = read("compile-time");
	const entries = (row: CompileRow): [string, number][] => [
		["grai", row.grai.edit],
		["Paraglide", row.paraglide[plainParaglide] ?? 0],
	];
	const groups = byKeys(rows, entries, (ms) => ms, duration);
	const largest: CompileRow = rows.at(-1);
	const title = "One message edited, compiled again";
	return {
		id: "edit",
		heading: "Compiling after one edit",
		readme: false,
		figures: [
			{
				id: "edit-compile",
				chart: {
					title,
					subtitle:
						"Milliseconds until the output holds the edit; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "keys", "one message edited"],
			...rows.flatMap((row: CompileRow) =>
				entries(row).map(([label, ms]) => [
					label,
					whole(row.keys),
					duration(ms),
				]),
			),
		],
		note: "grai compiles again only what the edit changed, from the build it kept; Paraglide compiles everything again, without declarations, as its Vite plugin does on an edit (`bench/compile-time.mjs`).",
		glance: [
			glanceOf(
				`Compile after one edit, ${whole(largest.keys)} keys`,
				entries(largest),
				duration,
			),
		],
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
	stub: { build: number };
	grai: Added;
	paraglide: Added;
};

export function buildSection(): Section {
	const { rows, versions, runs } = read("build-added");
	const libraries: [string, "grai" | "paraglide"][] = [
		["grai", "grai"],
		["Paraglide", "paraglide"],
	];
	const entries = (row: BuildRow): [string, number][] =>
		libraries.map(([label, key]) => [label, row[key].added]);
	const groups = byKeys(rows, entries, (ms) => ms / 1000, seconds);
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
	const largest: BuildRow = rows.at(-1);
	const title = "Time i18n adds to a production build";
	return {
		id: "build",
		heading: "A production build",
		readme: true,
		lead: "What i18n adds to an app's production build, against the same app with every message written in.",
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
				alt: found(title, groups),
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
		glance: [
			glanceOf(
				`Time i18n adds to a build, ${whole(largest.keys)} keys`,
				entries(largest),
				seconds,
			),
		],
	};
}

type HmrRow = { design: string; editToPage?: number; startToPage?: number };

const designs: [string, string][] = [
	["grai", "grai's plugin"],
	["Paraglide", "paraglide"],
	["i18next", "i18next"],
	["use-intl", "use-intl"],
];

/** The dev bench's figure of each library, by the field it recorded. */
function devEntries(field: "editToPage" | "startToPage") {
	const recorded = read("hmr-synthetic");
	const of = (design: string): HmrRow =>
		recorded.rows.find((row: HmrRow) => row.design === design);
	const entries = designs.map(([label, design]): [string, number] => [
		label,
		of(design)[field] ?? 0,
	]);
	return {
		chromium: recorded.chromium as string,
		edits: recorded.edits as number,
		entries,
		of,
	};
}

export function devSection(): Section {
	const { chromium, edits, entries } = devEntries("editToPage");
	const groups = [{ bars: barsOf(entries, (ms) => ms, duration) }];
	const title = "One message edited, until the page shows it";
	return {
		id: "dev",
		heading: "An edit in development",
		readme: true,
		figures: [
			{
				id: "dev-edit",
				chart: {
					title,
					subtitle: "Milliseconds in Vite's dev server; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "edit to page, ms"],
			...entries.map(([label, ms]) => [label, tenths(ms)]),
		],
		note: `A catalog saved until Chromium ${chromium} shows the edit, medians of ${edits} edits (\`bench/hmr.mjs\`). grai patches the open page in place; Paraglide's plugin compiles again, and i18next and use-intl send the locale's catalog again.`,
		glance: [glanceOf("Vite dev: an edit, until shown", entries, duration)],
	};
}

export function devStartSection(): Section {
	const { entries, of } = devEntries("startToPage");
	const groups = [{ bars: barsOf(entries, (ms) => ms, duration) }];
	const title = "A cold Vite dev server, until its page shows";
	return {
		id: "dev-start",
		heading: "Starting the dev server",
		readme: false,
		figures: [
			{
				id: "dev-start",
				chart: {
					title,
					subtitle:
						"Milliseconds from the server's creation, with no output or cache; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "start to page, ms"],
			...entries.map(([label, ms]) => [label, whole(ms)]),
			["no messages", whole(of("no messages").startToPage ?? 0)],
		],
		note: "Each library's dev server is made in a new directory, with no output and no cache, and timed until its page of messages shows (`bench/hmr.mjs`). grai's plugin and Paraglide's compile the catalogs as the server starts; i18next and use-intl load the locale's catalog in the page. One start each, in one process, grai's first; the last row is the same page with no messages.",
		glance: [
			glanceOf("Vite dev: a cold start, until shown", entries, duration),
		],
	};
}

type TypesRow = { library: string; tsc: number; first: number; next: number };

type TypesApp = {
	keys: number;
	calls: number;
	runs: number;
	typescript: { tsc: string; languageService: string };
	rows: TypesRow[];
};

export function typesSection(): Section {
	const apps = ["types-synthetic", "types-synthetic-13326"].map(
		(name): TypesApp => {
			const recorded = read(name);
			return {
				keys: Number(
					/([\d,]+) keys/.exec(recorded.app)?.[1]?.replaceAll(",", ""),
				),
				calls: recorded.calls,
				runs: recorded.runs,
				typescript: recorded.typescript,
				rows: recorded.rows,
			};
		},
	);
	const libraries: [string, string][] = [
		["grai", "grai's declarations"],
		["Paraglide", "Paraglide's declarations"],
		["i18next", "i18next's CustomTypeOptions"],
		["use-intl", "use-intl, keys inferred from the messages"],
	];
	const of = (rows: TypesRow[], name: string): TypesRow => {
		const row = rows.find((each) => each.library === name);
		if (row === undefined) throw new Error(`types has no row for ${name}`);
		return row;
	};
	const entries = (
		app: TypesApp,
		field: "tsc" | "first" | "next",
	): [string, number][] =>
		libraries.map(([label, name]) => [label, of(app.rows, name)[field]]);
	const largest = apps.at(-1);
	if (largest === undefined) throw new Error("types has no results");
	const completion = (
		field: "first" | "next",
		title: string,
		subtitle: string,
	) => {
		const groups = byKeys(
			apps,
			(app) => entries(app, field),
			(ms) => ms,
			duration,
		);
		return {
			id: `types-${field}`,
			chart: { title, subtitle, axis: "milliseconds", groups },
			alt: found(title, groups),
		};
	};
	return {
		id: "types",
		heading: "Completing a key in the editor",
		readme: false,
		lead: `In a file of ${whole(largest.calls)} message calls, an editor's first completion of a key checks the whole program; the ones after it complete from what it checked.`,
		figures: [
			completion(
				"first",
				"An editor's first completion of a key",
				"Milliseconds for TypeScript's language service, the program checked; lower is better",
			),
			completion(
				"next",
				"An editor's next completion of a key",
				"Milliseconds for TypeScript's language service, the program already checked; lower is better",
			),
		],
		table: [
			[
				"",
				"keys",
				"first completion, ms",
				"next completion, ms",
				"`tsc --noEmit`, ms",
			],
			...apps.flatMap((app) =>
				libraries.map(([label, name]) => {
					const row = of(app.rows, name);
					return [
						label,
						whole(app.keys),
						whole(row.first),
						whole(row.next),
						whole(row.tsc),
					];
				}),
			),
		],
		note: `Each library's keys typed its own way: grai's and Paraglide's generated declarations, i18next's keys merged from the locale's JSON through \`CustomTypeOptions\`, and use-intl's inferred from the messages it is given, the types next-intl uses too (\`bench/types.mjs\`). The completions are TypeScript ${largest.typescript.languageService}'s language service's, after \`m.\` or inside \`t("\`, as an editor asks for them, medians of ${largest.runs} new services. \`tsc --noEmit\` is TypeScript ${largest.typescript.tsc}'s, its process included, a median of ${largest.runs}.`,
		glance: [
			glanceOf(
				`Editor: first key completion, ${whole(largest.keys)} keys`,
				entries(largest, "first"),
				duration,
			),
			glanceOf(
				`Editor: next key completion, ${whole(largest.keys)} keys`,
				entries(largest, "next"),
				duration,
			),
			glanceOf(
				`\`tsc\` on ${whole(largest.calls)} calls, ${whole(largest.keys)} keys`,
				entries(largest, "tsc"),
				duration,
			),
		],
	};
}

type Timed = { cold: number; warm: number };

export function checkSection(): Section {
	const { rows, runs } = read("refactor-synthetic");
	const commands = ["check", "check --fix", "find", "rename"];
	const groups = commands.map((command) => {
		const timed: Timed = rows[command];
		return {
			heading: `grai ${command}`,
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
		heading: "The refactoring commands",
		readme: false,
		lead: "A cold check parses every file that may read messages and resolves its imports, which is what makes its reads exact, and costs seconds on a large project. Keep the facts it writes in CI's cache ([the guide's CI section](docs/guide.md#ci)), and a check reads only the files that changed.",
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
				alt: found(title, groups),
			},
		],
		table: [
			["", "nothing kept", "facts kept"],
			...commands.map((command) => [
				command,
				seconds(rows[command].cold),
				seconds(rows[command].warm),
			]),
		],
		note: `Each command in a new Node process, on a synthetic project of 13,000 keys in three locales and 9,000 source files, medians of ${runs} (\`bench/refactor.mjs\`). CI keeps the facts between runs.`,
		glance: [],
	};
}
