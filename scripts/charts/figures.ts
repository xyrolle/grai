// Every section of charts, strongest first, the rows of the table at a glance where grai is behind,
// and the numbers the README's text cites, each from the results a bench recorded
// (bench/results.mjs).

import { readdirSync } from "node:fs";
import { nextColdSection, nextEditSection } from "./nextjs.ts";
import {
	and,
	duration,
	type Glance,
	nanoseconds,
	read,
	type Section,
	seconds,
	spread,
	verdict,
	whole,
} from "./results.ts";
import {
	hydrateSection,
	ordinalsSection,
	pageSection,
	pluralsSection,
	runtimeSection,
	serverSection,
	ssrSection,
} from "./runtime.ts";
import {
	buildSection,
	checkSection,
	compileSection,
	devSection,
	devStartSection,
	editSection,
	typesSection,
} from "./tooling.ts";

/** A section's strongest row of the table at a glance, or none. */
const strongest = (section: Section) =>
	Math.max(
		...section.glance.map((glance) => verdict(glance).strength),
		Number.NEGATIVE_INFINITY,
	);

/** Every section, its strongest measure first; a section with nothing to compare goes last. */
export function sections(): Section[] {
	return [
		compileSection(),
		editSection(),
		buildSection(),
		devSection(),
		devStartSection(),
		typesSection(),
		pageSection(),
		hydrateSection(),
		serverSection(),
		ssrSection(),
		pluralsSection(),
		ordinalsSection(),
		runtimeSection(),
		nextColdSection(),
		nextEditSection(),
		checkSection(),
	].toSorted((a, b) => strongest(b) - strongest(a));
}

/** The rows of the table at a glance where grai is behind, its interval clear of level. */
export function behind(all: Section[]): Glance[] {
	return all
		.flatMap((section) => section.glance)
		.filter((glance) => verdict(glance).text.endsWith(", behind"));
}

/** What a recorded result's file holds about its run. */
type Run = {
	date: string;
	grai: string;
	load: { start: number; end: number };
};

/** The results the last bench of `pnpm readme` records, which end its window. */
const lastInWindow = "nextjs-synthetic";

/** What each bench measured, as the README says it when the bench was run on its own. */
const measured: Record<string, string> = {
	"build-added": "the production build",
	"compile-time": "the compile times",
	"dev-start-synthetic": "the dev server's first start",
	"dev-start-mixed-synthetic": "the dev server's first start on the mixed page",
	"dev-start-restart-synthetic": "the dev server's restart",
	"hmr-synthetic": "the dev server's edits",
	"hydrate-synthetic": "the page",
	"library-bytes-synthetic": "the runtime",
	"nextjs-synthetic": "Next.js",
	ordinals: "the ordinal forms",
	plurals: "the plural forms",
	"refactor-synthetic": "the refactoring commands",
	"server-synthetic": "the server's calls",
	"ssr-synthetic": "the server render",
	"types-synthetic": "the editor's completions at 6,366 keys",
	"types-synthetic-13326": "the editor's completions at 13,326 keys",
};

/** The days a window spans, in UTC: "28 Oct 2026", or "28–29 Oct 2026" across midnight. */
function days(first: number, last: number): string {
	const day = (time: number, parts: Intl.DateTimeFormatOptions) =>
		new Date(time).toLocaleDateString("en-GB", { timeZone: "UTC", ...parts });
	const whole = { day: "numeric", month: "short", year: "numeric" } as const;
	return day(first, whole) === day(last, whole)
		? day(last, whole)
		: `${day(first, { day: "numeric" })}–${day(last, whole)}`;
}

const capitalized = (text: string) =>
	`${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;

/** The numbers the README's text cites, by name, each from the results it was measured in. */
export function cited(): Record<string, string> {
	const shown = (section: Section, label: string) => {
		const bar = section.figures[0]?.chart.groups
			.flatMap((group) => group.bars)
			.find((each) => each.label === label);
		if (bar === undefined)
			throw new Error(`${section.id} has no bar for ${label}`);
		return bar.shown;
	};
	const page = pageSection();
	const dev = devSection();
	const runtime = runtimeSection();
	const refactor = read("refactor-synthetic").rows;
	const server = read("server-synthetic").rows;
	const plural = (variant: string) => {
		const row = server.findLast(
			(each: { variant: string }) => each.variant === variant,
		);
		return nanoseconds(spread(row.rounds.plural).median);
	};
	const { date, machine } = read(lastInWindow);
	// The results the charts draw from, which the window wrote: not another bench's that shares the
	// directory.
	const recorded = readdirSync(new URL("../../bench/results/", import.meta.url))
		.filter((file) => file.slice(0, -".json".length) in measured)
		.map((file) => {
			const name = file.slice(0, -".json".length);
			return { name, ...(read(name) as Run) };
		});
	// The window ends with the last bench `pnpm readme` runs; a bench run on its own after it is
	// said to be, with its time and load.
	const end = Date.parse(read(lastInWindow).date);
	const window = recorded.filter((run) => Date.parse(run.date) <= end);
	const after = recorded
		.filter((run) => Date.parse(run.date) > end)
		.toSorted((a, b) => Date.parse(a.date) - Date.parse(b.date));
	const loads = window.flatMap(({ load }) => [load.start, load.end]);
	const sameCode = after.every((run) => run.grai === window[0]?.grai);
	const at = ({ name, date, load }: Run & { name: string }) =>
		`${measured[name] ?? name} (${new Date(date).toISOString().slice(11, 16)} UTC, its load from ${whole(load.start)} to ${whole(load.end)})`;
	return {
		"bench-date": days(
			Math.min(...window.map((run) => Date.parse(run.date))),
			Date.parse(date),
		),
		"bench-machine": `${machine.cpu === "unknown" ? "a machine" : `an ${machine.cpu}`} with ${machine.cores} cores`,
		"bench-load": `${whole(Math.min(...loads))} to ${whole(Math.max(...loads))}`,
		"bench-after":
			after.length === 0
				? ""
				: ` ${capitalized(and(after.map(at)))} ${after.length === 1 ? "was" : "were"} measured on their own afterwards${sameCode ? ", on the same code" : ""}.`,
		"runtime-grai": shown(runtime, "grai"),
		"runtime-paraglide": shown(runtime, "Paraglide"),
		"runtime-i18next": shown(runtime, "i18next"),
		"runtime-use-intl": shown(runtime, "use-intl"),
		"page-grai": shown(page, "grai"),
		"page-paraglide": shown(page, "Paraglide"),
		"page-i18next": shown(page, "i18next, page's keys"),
		"dev-grai": shown(dev, "grai"),
		"dev-paraglide": shown(dev, "Paraglide"),
		"plural-grai": plural("grai `m.key()`"),
		"plural-paraglide": plural("Paraglide `m.key()`"),
		"check-warm": seconds(refactor.check.warmSamples.median),
		"check-cold": duration(refactor.check.coldSamples.median),
	};
}
