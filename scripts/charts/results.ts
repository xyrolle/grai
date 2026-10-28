// What every chart is drawn from: the results the benches recorded (bench/results.mjs), and the
// shapes a section of charts takes, with the formats their numbers are written in. A figure is a
// median of rounds with the interval that holds it (bench/medians.mjs); grai is compared with the
// others round by round, as the benches pair them, so that load a round shares cancels out.

import { readFileSync } from "node:fs";
import { median, medianInterval } from "../../bench/medians.mjs";
import type { Bar, BarChart, Group } from "./bars.ts";

/** A chart, its file's name, and what its alt text says it finds. */
export type Figure = { id: string; chart: BarChart; alt: string };

/** A median, the interval that holds it, and that interval's confidence. */
export type Interval = {
	median: number;
	low: number;
	high: number;
	confidence: number;
};

/**
 * How grai's figure compares with another's: their ratio to grai's, paired round by round; grai's
 * less theirs, in milliseconds, paired round by round, as the start benches pair them; or, for a
 * size, their ratio to grai's, which is exact.
 */
export type Comparison =
	| { kind: "ratio"; ratio: Interval }
	| { kind: "difference"; difference: Interval }
	| { kind: "exact" };

/**
 * One row of the table at a glance: a measure, lower is better, grai's figure and the best of the
 * others' in its recommended setup, how each is written, and how they compare.
 */
export type Glance = {
	measure: string;
	grai: number;
	other: { name: string; value: number };
	shown: (value: number) => string;
	comparison: Comparison;
};

/**
 * A section of charts: its heading, what its charts find in a sentence drawn from the numbers, the
 * charts, a table of the same numbers, how they were measured, and its rows of the table at a
 * glance. The README shows the sections marked `readme`; docs/benchmarks.md shows them all.
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

/** Samples' median and the interval that holds it. */
export const spread = (samples: readonly number[]): Interval => ({
	median: median(samples),
	...medianInterval(samples),
});

/** Figures round by round over the reference's in the same rounds: their ratio's spread. */
export const pairedRatio = (
	figures: readonly number[],
	references: readonly number[],
): Interval =>
	spread(figures.map((figure, round) => figure / (references[round] ?? 1)));

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
/** A render's milliseconds, to two places below one. */
export const milliseconds = (ms: number): string =>
	`${ms < 1 ? ms.toFixed(2) : tenths(ms)} ms`;
export const nanoseconds = (ns: number): string =>
	ns < 10 ? `${tenths(ns)} ns` : `${whole(ns)} ns`;
export const kilobytes = (bytes: number): string =>
	`${tenths(bytes / 1024)} KB`;

/** A ratio as a multiple: "390×", "6.4×", "0.98×". */
export function times(value: number): string {
	const digits = value >= 10 ? 0 : value >= 1 ? 1 : 2;
	return `${value.toLocaleString("en", { maximumFractionDigits: digits, minimumFractionDigits: digits })}×`;
}

/** A difference in milliseconds, with its sign: "+96 ms", "−40 ms". */
export const signed = (ms: number): string =>
	`${ms > 0 ? "+" : ms < 0 ? "−" : ""}${whole(Math.abs(ms))} ms`;

/** "a", "a and b", "a, b and c". */
export function and(words: string[]): string {
	return words.length < 2
		? words.join("")
		: `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** Bars sorted low to high, as every chart here is lower-is-better. */
export const sorted = (bars: Bar[]): Bar[] =>
	bars.toSorted((a, b) => a.value - b.value);

/** A figure, alone or with the interval that holds its median. */
export type Measured = number | Interval;

/** A figure's median, or the figure itself. */
export const middle = (figure: Measured): number =>
	typeof figure === "number" ? figure : figure.median;

/**
 * Each library's bar, sorted: its name, its value on the axis and as written, and its interval on
 * the axis where it has one.
 */
export const barsOf = (
	entries: [string, Measured][],
	axis: (value: number) => number,
	shown: (value: number) => string,
): Bar[] =>
	sorted(
		entries.map(([label, figure]) => ({
			label,
			value: axis(middle(figure)),
			shown: shown(middle(figure)),
			grai: label === "grai",
			...(typeof figure === "number"
				? {}
				: { interval: { low: axis(figure.low), high: axis(figure.high) } }),
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

/** A row of the table at a glance. */
export function glanceOf(
	measure: string,
	grai: Measured,
	other: [string, Measured],
	shown: (value: number) => string,
	comparison: Comparison,
): Glance {
	return {
		measure,
		grai: middle(grai),
		other: { name: other[0], value: middle(other[1]) },
		shown,
		comparison,
	};
}

/** The others' entry with the lowest figure: the best competitor on a lower-is-better measure. */
export function best<Entry extends [string, Measured]>(
	entries: Entry[],
): Entry {
	const [first, ...rest] = entries.filter(([label]) => label !== "grai");
	if (first === undefined) throw new Error("no competitor to compare with");
	return rest.reduce(
		(low, each) => (middle(each[1]) < middle(low[1]) ? each : low),
		first,
	);
}

/** An interval as a table writes it, its confidence named when under 95%. */
export function between(
	{ low, high, confidence }: Interval,
	write: (value: number) => string,
): string {
	const named =
		confidence < 0.95 ? `, ${Math.floor(confidence * 100)}% interval` : "";
	return `${write(low)} to ${write(high)}${named}`;
}

/**
 * How a row reads, and how strong it is: a ratio above 1 or a difference below 0 is grai ahead.
 * A row whose interval holds 1, or 0, is level.
 */
export function verdict(glance: Glance): { text: string; strength: number } {
	const { comparison, grai, other } = glance;
	const strength = other.value / grai;
	if (comparison.kind === "exact")
		return {
			text: strength >= 1 ? times(strength) : `${times(strength)}, behind`,
			strength,
		};
	if (comparison.kind === "ratio") {
		const { ratio } = comparison;
		const range = `(${between(ratio, times)})`;
		return {
			text:
				ratio.low > 1
					? `${times(ratio.median)} ${range}`
					: ratio.high < 1
						? `${times(ratio.median)} ${range}, behind`
						: `level ${range}`,
			strength: ratio.median,
		};
	}
	const { difference } = comparison;
	const range = `(${between(difference, signed)})`;
	return {
		text:
			difference.high < 0
				? `${signed(difference.median)} ${range}`
				: difference.low > 0
					? `${signed(difference.median)} ${range}, behind`
					: `level ${range}`,
		strength,
	};
}
