// Every section of charts, strongest first, and the numbers the README's text cites, each from
// the results a bench recorded (bench/results.mjs).

import { readdirSync } from "node:fs";
import { nextColdSection, nextEditSection } from "./nextjs.ts";
import {
	and,
	type Glance,
	nanoseconds,
	read,
	type Section,
	seconds,
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

/** How many times grai's figure the other's is: above 1, grai is ahead. */
export const ratio = ({ grai, other }: Glance): number => other.value / grai;

/** A section's strongest row of the at-a-glance table, or none. */
const strongest = (section: Section) =>
	Math.max(...section.glance.map(ratio), Number.NEGATIVE_INFINITY);

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

const capitalized = (text: string) =>
	`${text.slice(0, 1).toUpperCase()}${text.slice(1)}`;

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
	"compile-time": "the compile times",
	"dev-start-synthetic": "the dev server's cold start",
	"refactor-synthetic": "the refactoring commands",
	"server-synthetic": "the server's calls",
	"ssr-synthetic": "the server render",
	plurals: "the plural forms",
	ordinals: "the ordinal forms",
	"types-synthetic": "the editor's completions at 6,366 keys",
	"types-synthetic-13326": "the editor's completions at 13,326 keys",
	"hydrate-synthetic": "the page",
	"hmr-synthetic": "the dev server's edits",
	"library-bytes-synthetic": "the runtime's size",
	"build-added": "the production build",
};

/** The numbers the README's text cites, by name, each from the results it was measured in. */
export function cited(): Record<string, string> {
	const shown = (section: Section, label: string) =>
		section.figures[0]?.chart.groups[0]?.bars.find(
			(each) => each.label === label,
		)?.shown ?? "";
	const page = pageSection();
	const dev = devSection();
	const start = devStartSection().glance[0];
	const runtime = runtimeSection();
	const refactor = read("refactor-synthetic").rows;
	const server = read("server-synthetic").rows;
	const plural = (variant: string) =>
		nanoseconds(
			server.findLast((row: { variant: string }) => row.variant === variant).ns
				.plural,
		);
	const { date, machine } = read("build-added");
	const recorded = readdirSync(new URL("../../bench/results/", import.meta.url))
		.filter((file) => file.endsWith(".json"))
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
		"bench-date": new Date(date).toLocaleDateString("en-GB", {
			day: "numeric",
			month: "short",
			year: "numeric",
		}),
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
		"page-i18next": shown(page, "i18next"),
		"dev-grai": shown(dev, "grai"),
		"start-grai": start === undefined ? "" : start.shown(start.grai),
		"start-best":
			start === undefined
				? ""
				: `${start.shown(start.other.value)} on ${start.other.name}`,
		"dev-paraglide": shown(dev, "Paraglide"),
		"plural-grai": plural("grai `m.key()`"),
		"plural-paraglide": plural("Paraglide `m.key()`"),
		"check-warm": seconds(refactor.check.warm),
		"check-cold": seconds(refactor.check.cold),
	};
}
