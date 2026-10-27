// What every chart is drawn from: the results the benches recorded (bench/results.mjs), and the
// shapes a section of charts takes, with the formats their numbers are written in.

import { readFileSync } from "node:fs";
import type { Bar, BarChart, Group } from "./bars.ts";

/** A chart, its file's name, and what its alt text says it finds. */
export type Figure = { id: string; chart: BarChart; alt: string };

/**
 * One row of the at-a-glance table: a measure, lower is better, grai's figure and the best of
 * the others', and how each is written.
 */
export type Glance = {
	measure: string;
	grai: number;
	other: { name: string; value: number };
	shown: (value: number) => string;
};

/**
 * A section of charts: its heading, what its charts find in a sentence drawn from the numbers, the
 * charts, a table of the same numbers, how they were measured, and its rows of the at-a-glance
 * table. The README shows the sections marked `readme`; docs/benchmarks.md shows them all.
 */
export type Section = {
	id: string;
	heading: string;
	readme: boolean;
	lead?: string;
	figures: Figure[];
	table: string[][];
	note: string;
	glance: Glance[];
};

const results = new URL("../../bench/results/", import.meta.url);

/** The JSON a bench wrote, as `JSON.parse` types it: each reader says which fields it takes. */
type Recorded = ReturnType<typeof JSON.parse>;

/** A bench's recorded results, by the name it recorded them under. */
export const read = (name: string): Recorded =>
	JSON.parse(readFileSync(new URL(`${name}.json`, results), "utf8"));

export const whole = (value: number): string =>
	Math.round(value).toLocaleString("en");
export const tenths = (value: number): string =>
	value.toLocaleString("en", {
		maximumFractionDigits: 1,
		minimumFractionDigits: 1,
	});
export const seconds = (ms: number): string =>
	`${(ms / 1000).toLocaleString("en", { maximumFractionDigits: 2, minimumFractionDigits: 2 })} s`;
/** Milliseconds as a person reads them: "15 ms", "1.12 s", "75.4 s". */
export const duration = (ms: number): string =>
	ms < 1000
		? `${whole(ms)} ms`
		: ms < 10_000
			? seconds(ms)
			: `${(ms / 1000).toLocaleString("en", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} s`;
export const nanoseconds = (ns: number): string =>
	ns < 10 ? `${tenths(ns)} ns` : `${whole(ns)} ns`;
export const kilobytes = (bytes: number): string =>
	`${tenths(bytes / 1024)} KB`;

/** "a", "a and b", "a, b and c". */
export function and(words: string[]): string {
	return words.length < 2
		? words.join("")
		: `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** Bars sorted low to high, as every chart here is lower-is-better. */
export const sorted = (bars: Bar[]): Bar[] =>
	bars.toSorted((a, b) => a.value - b.value);

/** Each library's bar, sorted: its name, its value on the axis, and its value as written. */
export const barsOf = (
	entries: [string, number][],
	axis: (value: number) => number,
	shown: (value: number) => string,
): Bar[] =>
	sorted(
		entries.map(([label, value]) => ({
			label,
			value: axis(value),
			shown: shown(value),
			grai: label === "grai",
		})),
	);

/** "grai 21 ns, Paraglide 48 ns and i18next 1,500 ns", in the bars' order. */
export function listed(bars: Bar[]): string {
	return and(bars.map(({ label, shown }) => `${label} ${shown}`));
}

/** What a chart's groups show, in a sentence for its alt text. */
export function found(title: string, groups: Group[]): string {
	return `${title}: ${groups
		.map(({ heading, bars }) =>
			heading === undefined ? listed(bars) : `${heading}, ${listed(bars)}`,
		)
		.join("; ")}.`;
}

/** The lowest of the others' figures, by name: the best competitor on a lower-is-better measure. */
export function best(entries: [string, number][]): {
	name: string;
	value: number;
} {
	const [name, value] = entries
		.filter(([label]) => label !== "grai")
		.reduce((low, each) => (each[1] < low[1] ? each : low));
	return { name, value };
}

/** grai's figure among `entries` against the best of the others', as a row of the table. */
export function glanceOf(
	measure: string,
	entries: [string, number][],
	shown: (value: number) => string,
): Glance {
	const grai = entries.find(([label]) => label === "grai")?.[1];
	if (grai === undefined) throw new Error(`${measure} has no figure of grai's`);
	return { measure, grai, other: best(entries), shown };
}
