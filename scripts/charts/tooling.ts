// The charts of what a developer waits for: compiling the catalogs, again after one edit, a
// production build, an edit in Vite's dev server and its start, the editor's completion of a key,
// and grai's refactoring commands.

import type { Group } from "./bars.ts";
import {
	barsOf,
	best,
	between,
	duration,
	found,
	glanceOf,
	type Interval,
	type Measured,
	pairedRatio,
	read,
	type Section,
	seconds,
	signed,
	spread,
	whole,
} from "./results.ts";

/** A figure with its interval, as a table cell writes it: "1.12 s (0.98 s to 1.30 s)". */
const cell = (figure: Interval, write: (value: number) => string = duration) =>
	`${write(figure.median)} (${between(figure, write)})`;

/** Groups of bars, one a row: its heading the row's keys. */
const byKeys = <Row extends { keys: number }>(
	rows: Row[],
	entries: (row: Row) => [string, Measured][],
	axis: (value: number) => number,
	shown: (value: number) => string,
): Group[] =>
	rows.map((row) => ({
		heading: `${whole(row.keys)} keys`,
		bars: barsOf(entries(row), axis, shown),
	}));

/** The last of a bench's rows, its largest catalog, which the table at a glance shows. */
function largest<Row>(rows: Row[]): Row {
	const row = rows.at(-1);
	if (row === undefined) throw new Error("a bench recorded no rows");
	return row;
}

const plain = "Paraglide, message modules, without declarations";
const typed = "Paraglide, message modules, declarations through TypeScript 6";
const devPlain =
	"Paraglide's Vite plugin in dev, locale modules, without declarations";
const devTyped =
	"Paraglide's Vite plugin in dev, locale modules, declarations through TypeScript 6";

type CompileVariant = { cold: Interval; noop?: Interval; edit?: Interval };
type CompileRow = {
	keys: number;
	variants: Record<string, CompileVariant>;
	ratios: Record<string, Interval>;
};

/** A compile-time variant's figure, or a missing one named. */
function compiled(row: CompileRow, variant: string): CompileVariant {
	const figures = row.variants[variant];
	if (figures === undefined)
		throw new Error(`compile-time has no ${variant} at ${row.keys} keys`);
	return figures;
}

/** A compile-time ratio, theirs over grai's by round, or a missing one named. */
function compileRatio(row: CompileRow, name: string): Interval {
	const ratio = row.ratios[name];
	if (ratio === undefined)
		throw new Error(`compile-time has no ratio ${name} at ${row.keys} keys`);
	return ratio;
}

const editOf = (figures: CompileVariant): Interval => {
	if (figures.edit === undefined)
		throw new Error("compile-time has no edit for a variant that edits");
	return figures.edit;
};

export function compileSection(): Section {
	const { rows, runs, versions } = read("compile-time");
	const entries = (row: CompileRow): [string, Measured][] => [
		["grai", compiled(row, "grai").cold],
		["Paraglide", compiled(row, plain).cold],
		["Paraglide, declarations", compiled(row, typed).cold],
	];
	const groups = byKeys(rows, entries, (ms) => ms / 1000, duration);
	const last: CompileRow = largest(rows);
	const title = "Compiling the catalogs";
	return {
		id: "compile",
		heading: "Compiling the catalogs",
		readme: true,
		lead: "grai's output always carries each message's declarations, so the like-for-like row is Paraglide's compile with declarations, which it emits through TypeScript 6; its compile without them is beside it.",
		figures: [
			{
				id: "compile",
				chart: {
					title,
					subtitle:
						"Seconds for a full compile of three locales from no output, in a new process; lower is better",
					axis: "seconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "keys", "full compile", "nothing changed"],
			...rows.flatMap((row: CompileRow) => [
				[
					"grai",
					whole(row.keys),
					cell(compiled(row, "grai").cold),
					cell(compiled(row, "grai").noop ?? compiled(row, "grai").cold),
				],
				...[plain, typed].map((variant) => [
					variant,
					whole(row.keys),
					cell(compiled(row, variant).cold),
					"the same",
				]),
			]),
		],
		note: `Each compile in a new Node process, timed once the library's modules have loaded, from the same restored catalogs and no output; the variants take turns in rounds whose order rotates, medians of ${runs} with the interval that holds each (\`bench/compile-time.mjs\`). Every output's texts and declarations are checked after its clock. Paraglide ${versions["@inlang/paraglide-js"]}'s compiler is in its production layout, message modules. The ratios in the table at a glance are Paraglide's time over grai's, paired by round.`,
		glance: [
			glanceOf(
				`Full compile, ${whole(last.keys)} keys, both emit declarations`,
				compiled(last, "grai").cold,
				["Paraglide with declarations", compiled(last, typed).cold],
				duration,
				{ kind: "ratio", ratio: compileRatio(last, `${typed}, cold`) },
			),
			glanceOf(
				`Full compile, ${whole(last.keys)} keys, Paraglide without declarations`,
				compiled(last, "grai").cold,
				["Paraglide without declarations", compiled(last, plain).cold],
				duration,
				{ kind: "ratio", ratio: compileRatio(last, `${plain}, cold`) },
			),
		].map((glance) => ({ ...glance, together: "compile" })),
	};
}

export function editSection(): Section {
	const { rows, runs } = read("compile-time");
	const entries = (row: CompileRow): [string, Measured][] => [
		["grai", editOf(compiled(row, "grai"))],
		["Paraglide", editOf(compiled(row, devPlain))],
		["Paraglide, declarations", editOf(compiled(row, devTyped))],
	];
	const groups = byKeys(rows, entries, (ms) => ms, duration);
	const last: CompileRow = largest(rows);
	const title = "One message edited, compiled again";
	const against = (variant: string, setup: string, other: string) => ({
		...glanceOf(
			`Compile after one edit, ${whole(last.keys)} keys, ${setup}`,
			editOf(compiled(last, "grai")),
			[other, editOf(compiled(last, variant))],
			duration,
			{ kind: "ratio", ratio: compileRatio(last, `${variant}, edit`) },
		),
		together: "edit",
	});
	return {
		id: "edit",
		heading: "Compiling after one edit",
		readme: false,
		lead: "grai's recompile against Paraglide's Vite plugin in dev (locale modules), each from the compilation it kept.",
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
			["", "keys", "its first compile", "one message edited"],
			...rows.flatMap((row: CompileRow) =>
				[
					["grai", "grai"],
					[devPlain, devPlain],
					[devTyped, devTyped],
				].map(([label = "", variant = ""]) => [
					label,
					whole(row.keys),
					cell(compiled(row, variant).cold),
					cell(editOf(compiled(row, variant))),
				]),
			),
		],
		note: `The same message edited each time, its text replaced as an editor saves it: grai compiles again by \`recompile\` from the build its compile before kept, as its Vite plugin and \`grai watch\` do; Paraglide's Vite plugin, as a dev server drives it, compiles again by its \`watchChange\` from the compilation it kept, in the layout it takes in development, locale modules, without declarations and with them. Medians of ${runs} rounds in rotating order, each in a new process (\`bench/compile-time.mjs\`).`,
		glance: [
			against(
				devPlain,
				"Paraglide's default",
				"Paraglide's Vite plugin in dev, without declarations, its default",
			),
			against(
				devTyped,
				"both emit declarations",
				"Paraglide's Vite plugin in dev, declarations through TypeScript 6",
			),
		],
	};
}

type Spread = Interval & { samples: number[] };
type BuildLibrary = {
	builds: Spread;
	additions: Spread;
	buildStarts: Spread;
	rests: Spread;
	hooks: { hook: string; ms: number }[][];
	runs: { builds: number[] };
};
type BuildRow = {
	keys: number;
	stub: { builds: Spread };
	grai: BuildLibrary;
	paraglide: BuildLibrary;
	paraglideOverGrai: Interval;
};

export function buildSection(): Section {
	const { rows, versions, runs, clock } = read("build-added");
	const libraries: [string, "grai" | "paraglide"][] = [
		["grai", "grai"],
		["Paraglide", "paraglide"],
	];
	const entries = (row: BuildRow): [string, Measured][] =>
		libraries.map(([label, key]) => [label, row[key].additions]);
	const groups = byKeys(rows, entries, (ms) => ms / 1000, seconds);
	/** The hooks Rolldown named in the build whose time is the median, the one the table shows. */
	const named = (each: BuildLibrary) => {
		const index = each.runs.builds.indexOf(each.builds.median);
		const hooks = each.hooks[index] ?? [];
		return hooks.length === 0
			? "none of 1 s or more"
			: hooks.map(({ hook, ms }) => `${hook} ${seconds(ms)}`).join(", ");
	};
	const last: BuildRow = largest(rows);
	const title = "Time i18n adds to a production build";
	return {
		id: "build",
		heading: "A production build",
		readme: true,
		lead: `What i18n adds to an app's production build, against the same app with every message's text written in. Each build is clocked ${clock}.`,
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
			["", "keys", "build", "added", "its plugins' buildStart", "the rest"],
			...rows.flatMap((row: BuildRow) => [
				[
					"without i18n",
					whole(row.keys),
					cell(row.stub.builds, seconds),
					"",
					"",
					"",
				],
				...libraries.map(([label, key]) => {
					const each = row[key];
					return [
						label,
						whole(row.keys),
						cell(each.builds, seconds),
						cell(each.additions, seconds),
						cell(each.buildStarts, seconds),
						cell(each.rests, seconds),
					];
				}),
			]),
		],
		note: `Vite ${versions.vite} (Rolldown ${versions.rolldown}) builds one app of 64 pages that call every key of the synthetic catalog, on grai, on Paraglide ${versions["@inlang/paraglide-js"]} and with every message's text written in, each build a new process from a clean checkout; the three take turns in rounds whose order rotates, medians of ${runs} with the interval that holds each (\`bench/build-added.mjs\`). Added is a build less the build without i18n of the same round. Its plugins' \`buildStart\`, where both compile the catalogs, is timed around the plugins' own hooks; the rest is everything else the library adds. After each build, outside its clock, every page is opened in Chromium and must draw its texts. Rolldown names a plugin hook of a second or more: in the median build, ${libraries.map(([label, key]) => `${label}'s ${named(last[key])}`).join(", ")} at ${whole(last.keys)} keys.`,
		glance: [
			glanceOf(
				`Time i18n adds to a production build, ${whole(last.keys)} keys`,
				last.grai.additions,
				["Paraglide", last.paraglide.additions],
				seconds,
				{ kind: "ratio", ratio: last.paraglideOverGrai },
			),
		],
	};
}

const designs: [string, string][] = [
	["grai", "grai's plugin"],
	["Paraglide", "paraglide"],
	["i18next", "i18next"],
	["use-intl", "use-intl"],
];

/** The page with no messages, which draws the same texts from its own code. */
const noMessages: [string, string] = ["no messages", "no messages"];

type HmrRow = { design: string; edits: Interval };

export function devSection(): Section {
	const { rows, pairs, chromium, edits, rounds } = read("hmr-synthetic");
	const of = (design: string): HmrRow => {
		const row = rows.find((each: HmrRow) => each.design === design);
		if (row === undefined) throw new Error(`hmr has no ${design}`);
		return row;
	};
	const entries = designs.map(([label, design]): [string, Interval] => [
		label,
		of(design).edits,
	]);
	const groups = [{ bars: barsOf(entries, (ms) => ms, duration) }];
	const [name, figure] = best(entries);
	const design = designs.find(([label]) => label === name)?.[1] ?? name;
	const title = "One message edited, until the DOM is updated";
	return {
		id: "dev",
		heading: "An edit in development",
		readme: true,
		figures: [
			{
				id: "dev-edit",
				chart: {
					title,
					subtitle:
						"Milliseconds in Vite's dev server, from the catalog's save; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "edit to the DOM updated", "theirs over grai's, by round"],
			...entries.map(([label, edit]) => {
				const pair = pairs[designs.find(([each]) => each === label)?.[1] ?? ""];
				return [
					label,
					cell(edit),
					pair === undefined
						? ""
						: `${pair.median.toFixed(2)}× (${between(pair, (value) => `${value.toFixed(2)}×`)})`,
				];
			}),
		],
		note: `A catalog saved as an editor saves it until the page's MutationObserver in Chromium ${chromium} sees the edited text, ${edits} edits a design (\`bench/hmr.mjs\`). Each design's session takes its turn once a round, in an order that rotates, ${rounds.length} rounds, each design's edits paired with grai's plugin's of the same round. grai patches the open page in place; Paraglide's plugin compiles again, and i18next and use-intl send the locale's catalog again.`,
		glance: [
			glanceOf(
				"Vite dev: one message edited, until the DOM is updated",
				of("grai's plugin").edits,
				[name, figure],
				duration,
				{ kind: "ratio", ratio: pairs[design] },
			),
		],
	};
}

type StartRow = { design: string; runs: number[] };
type StartRecord = {
	page: string;
	rows: StartRow[];
	differences: { against: string; runs: number[] }[];
};

/** A dev start bench's record, by the page its starts load. */
const startRecord = (name: string): StartRecord => read(name);

export function devStartSection(): Section {
	const pages: [string, string][] = [
		["A first start, 500 plain texts", "dev-start-synthetic"],
		["A restart, 500 plain texts", "dev-start-restart-synthetic"],
		[
			"A first start, 500 calls in the catalog's mix",
			"dev-start-mixed-synthetic",
		],
	];
	const records = pages.map(([heading, name]) => ({
		heading,
		record: startRecord(name),
	}));
	const timed = ({ rows }: StartRecord, design: string): Interval => {
		const row = rows.find((each) => each.design === design);
		if (row === undefined) throw new Error(`dev-start has no ${design}`);
		return spread(row.runs);
	};
	const entries = (record: StartRecord) =>
		designs.map(([label, design]): [string, Interval] => [
			label,
			timed(record, design),
		]);
	const groups = records.map(({ heading, record }) => ({
		heading,
		bars: barsOf(entries(record), (ms) => ms, duration),
	}));
	const glance = (measure: string, record: StartRecord) => {
		const [name, figure] = best(entries(record));
		const design = designs.find(([label]) => label === name)?.[1] ?? name;
		const difference = record.differences.find(
			(each) => each.against === design,
		);
		if (difference === undefined)
			throw new Error(`dev-start has no difference against ${design}`);
		return glanceOf(
			measure,
			timed(record, "grai's plugin"),
			[name, figure],
			duration,
			{ kind: "difference", difference: spread(difference.runs) },
		);
	};
	const [first, restart] = records;
	if (first === undefined || restart === undefined)
		throw new Error("dev-start has no first start or restart");
	const title = "A Vite dev server, until its page shows";
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
						"Milliseconds from the import of the library's Vite plugin until the page's texts are drawn; lower is better",
					axis: "milliseconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "start", "until shown", "grai's less theirs, by round"],
			...records.flatMap(({ heading, record }) =>
				[...designs, noMessages].map(([label, design]) => {
					const difference = record.differences.find(
						(each) => each.against === design,
					);
					return [
						label,
						heading,
						cell(timed(record, design)),
						difference === undefined
							? ""
							: cell(spread(difference.runs), signed),
					];
				}),
			),
		],
		note: "Each start is a new Node process, timed from the import of its library's Vite plugin, as an app's config imports it before its server starts, once Vite and Chromium have loaded, until the frame drawn after the page's texts are in the DOM (`bench/dev-start.mjs`). A first start is in a new directory with no output and no cache, Vite's own among them; a restart follows a first start of its own library and keeps what it wrote. i18next and use-intl have no plugin to import and load the locale's catalog in the page. Every library starts once a round, in an order that rotates; medians with the interval that holds each, and grai's start less each other's of the same round. The page with no messages draws the same texts from its own code.",
		glance: [
			glance("Vite dev: a first start, until its page shows", first.record),
			glance("Vite dev: a restart, until its page shows", restart.record),
		],
	};
}

type Steps = Record<string, number[]>;
type TypesRow = {
	library: string;
	samples: { tsc: number[]; ts6: Steps; ts7: Steps };
};
type TypesApp = {
	keys: number;
	calls: number;
	runs: number;
	typescript: { tsc: string; languageService: string; languageServer: string };
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
	const of = (app: TypesApp, name: string): TypesRow => {
		const row = app.rows.find((each) => each.library === name);
		if (row === undefined) throw new Error(`types has no row for ${name}`);
		return row;
	};
	/** A step's samples, round by round: `tsc`'s, or the language service's. */
	const samplesOf = (row: TypesRow, step: string): number[] => {
		const samples = step === "tsc" ? row.samples.tsc : row.samples.ts6[step];
		if (samples === undefined) throw new Error(`types has no ${step}`);
		return samples;
	};
	const entries = (app: TypesApp, step: string): [string, Interval][] =>
		libraries.map(([label, name]) => [
			label,
			spread(samplesOf(of(app, name), step)),
		]);
	const last = largest(apps);
	const completion = (step: string, title: string, subtitle: string) => {
		const groups = byKeys(
			apps,
			(app) => entries(app, step),
			(ms) => ms,
			duration,
		);
		return {
			id: `types-${step}`,
			chart: { title, subtitle, axis: "milliseconds", groups },
			alt: found(title, groups),
		};
	};
	const glance = (step: string, measure: string) => {
		const [name, figure] = best(entries(last, step));
		const library = libraries.find(([label]) => label === name)?.[1] ?? name;
		return glanceOf(
			`${measure}, ${whole(last.keys)} keys`,
			spread(samplesOf(of(last, "grai's declarations"), step)),
			[name, figure],
			duration,
			{
				kind: "ratio",
				ratio: pairedRatio(
					samplesOf(of(last, library), step),
					samplesOf(of(last, "grai's declarations"), step),
				),
			},
		);
	};
	const steps: [string, string][] = [
		["first", "first completion, the file opened"],
		["next", "repeated completion, file unchanged"],
		["prefix", "completion after an edit: a typed prefix"],
		["callSite", "completion after an edit: a new call site"],
		["catalog", "completion after an edit: a key added to the catalog"],
		["tsc", "`tsc --noEmit`"],
	];
	return {
		id: "types",
		heading: "Completing a key in the editor",
		readme: false,
		lead: `In a file of ${whole(last.calls)} message calls, each library's keys typed its own way: completions as an editor asks TypeScript ${last.typescript.languageService}'s language service for them, after \`m.\` or inside \`t("\`.`,
		figures: [
			completion(
				"prefix",
				"Completion after an edit: a typed prefix",
				"Milliseconds for the language service to tell of the edit and list the keys; lower is better",
			),
			completion(
				"next",
				"Repeated completion, file unchanged",
				"Milliseconds for the language service to list the keys again; lower is better",
			),
		],
		table: [
			["", "keys", ...steps.map(([, label]) => label)],
			...apps.flatMap((app) =>
				libraries.map(([label, name]) => [
					label,
					whole(app.keys),
					...steps.map(([step]) =>
						cell(spread(samplesOf(of(app, name), step))),
					),
				]),
			),
		],
		note: `grai's and Paraglide's generated declarations, i18next's keys merged from the locale's JSON through \`CustomTypeOptions\`, and use-intl's inferred from the messages it is given, the types next-intl uses too (\`bench/types.mjs\`). Each sample is a new process, every library taking one a round in an order that rotates, medians of ${last.runs}; with ${last.runs} rounds an interval is the lowest and highest sample, and holds the median with the confidence it names. Every list must hold exactly the keys the library's types give. TypeScript ${last.typescript.languageServer}'s language server answers the same completions too: its samples are in \`bench/results/types-*.json\`. \`tsc --noEmit\` is TypeScript ${last.typescript.tsc}'s, its process included.`,
		glance: [
			glance("prefix", "Editor: completion after an edit (a typed prefix)"),
			glance("next", "Editor: repeated completion, file unchanged"),
			glance("tsc", `\`tsc --noEmit\` on ${whole(last.calls)} calls`),
		],
	};
}

type RefactorRow = {
	ran: string;
	coldSamples: Interval;
	warmSamples: Interval;
};

export function checkSection(): Section {
	const { rows, runs, clock } = read("refactor-synthetic");
	const commands = Object.keys(rows);
	const timed = (command: string): RefactorRow => {
		const row = rows[command];
		if (row === undefined) throw new Error(`refactor has no ${command}`);
		return row;
	};
	const modes: [string, "coldSamples" | "warmSamples"][] = [
		["cold", "coldSamples"],
		["warm", "warmSamples"],
	];
	const groups = commands.map((command) => ({
		heading: `grai ${command}`,
		bars: modes.map(([label, field]) => {
			const interval = timed(command)[field];
			return {
				label,
				value: interval.median / 1000,
				shown: seconds(interval.median),
				grai: true,
				interval: { low: interval.low / 1000, high: interval.high / 1000 },
			};
		}),
	}));
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
						"Seconds from the CLI's launch until it exits, in a new Node process; cold: no facts or file listing kept; warm: what the run before left; lower is better",
					axis: "seconds",
					groups,
				},
				alt: found(title, groups),
			},
		],
		table: [
			["", "no facts or file listing kept", "what the run before left"],
			...commands.map((command) => [
				`\`${timed(command).ran}\``,
				cell(timed(command).coldSamples, seconds),
				cell(timed(command).warmSamples, seconds),
			]),
		],
		note: `${clock[0]?.toUpperCase()}${clock.slice(1)}, on a synthetic project of 13,000 keys in three locales and 9,000 source files; cold and warm interleaved in rounds whose order rotates, medians of ${runs} with the interval that holds each (\`bench/refactor.mjs\`). Cold keeps nothing grai keeps between commands; the compiled output and the file system's caches stay. Each result is checked exactly after its clock.`,
		glance: [],
	};
}
