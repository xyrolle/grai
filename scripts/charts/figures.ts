// Every section of charts, strongest first, and the numbers the README's text cites, each from
// the results a bench recorded (bench/results.mjs).

import { readdirSync } from "node:fs";
import { nextColdSection, nextEditSection } from "./nextjs.ts";
import {
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

/** The numbers the README's text cites, by name, each from the results it was measured in. */
export function cited(): Record<string, string> {
	const shown = (section: Section, label: string) =>
		section.figures[0]?.chart.groups[0]?.bars.find(
			(each) => each.label === label,
		)?.shown ?? "";
	const page = pageSection();
	const dev = devSection();
	const runtime = runtimeSection();
	const refactor = read("refactor-synthetic").rows;
	const server = read("server-synthetic").rows;
	const plural = (variant: string) =>
		nanoseconds(
			server.findLast((row: { variant: string }) => row.variant === variant).ns
				.plural,
		);
	const { date, machine } = read("build-added");
	const loads = readdirSync(new URL("../../bench/results/", import.meta.url))
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
		"runtime-grai": shown(runtime, "grai"),
		"runtime-paraglide": shown(runtime, "Paraglide"),
		"runtime-i18next": shown(runtime, "i18next"),
		"runtime-use-intl": shown(runtime, "use-intl"),
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
