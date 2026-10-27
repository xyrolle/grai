// A cold `next dev`'s first page: each app started from an empty .next, ROUNDS times, timed from the
// process's launch until its first response is complete and, in a start of its own, until Chromium
// has hydrated it. grai starts twice: with its output prepared, as its watch leaves it after a
// session (the groups of keys its routes read saved), and from an empty outdir in a copy of its app,
// compiling the catalogs as Next starts. next-intl starts twice: with its provider
// passing the client component every message, as by default, and only its keys, as its docs
// advise. The apps take turns in an order that rotates each round, so each takes each place in a
// round alike and the machine's load weighs on all alike; a block is one turn of the rotation.
// Each round pairs grai with the others: the median of those differences, their range and each
// block's median say how far apart the apps are.
import { devStart, hydratedStart } from "./next-dev.mjs";
import { stopServer } from "./servers.mjs";

export const COLD_ROUNDS = 12;

/**
 * The apps the rounds start, each with the directories a start removes first. grai's empty outdir
 * is a copy of its app (`emptyOutput`), so that its starts leave the prepared app's output as its
 * watch prepared it.
 */
export function coldApps(apps, emptyOutput) {
	return [
		{ name: "grai", root: apps.grai, cleared: [".next"] },
		{
			name: "grai, empty output",
			root: emptyOutput,
			cleared: [".next", "src/i18n"],
		},
		{ name: "next-intl", root: apps["next-intl"], cleared: [".next"] },
		{
			name: "next-intl, client keys picked",
			root: apps["next-intl, client keys picked"],
			cleared: [".next"],
		},
	];
}

/** The pairs whose differences the rounds report: the first app's time less the second's. */
const coldPairs = [
	["grai", "next-intl"],
	["grai", "next-intl, client keys picked"],
	["grai, empty output", "next-intl"],
];

const median = (values) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length / 2;
	return Number.isInteger(middle)
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[Math.floor(middle)];
};
const spread = (values) => ({
	median: median(values),
	min: Math.min(...values),
	max: Math.max(...values),
});

/**
 * One round: each app started in turn, from `first` on, until its first response, then each again
 * until hydrated; each app's sample by name.
 */
async function round(browser, apps, first, path, words) {
	const order = apps.map((_, turn) => apps[(first + turn) % apps.length]);
	const samples = {};
	for (const { name, root, cleared } of order) {
		const { server, ready, page, cpu } = await devStart(
			root,
			path,
			words,
			cleared,
		);
		await stopServer(server.child);
		samples[name] = { ready, page, cpu };
	}
	for (const { name, root, cleared } of order) {
		const { server, hydrated } = await hydratedStart(
			browser,
			root,
			path,
			words,
			cleared,
		);
		await stopServer(server.child);
		samples[name].hydrated = hydrated;
	}
	return samples;
}

/**
 * Each app's samples, by name, one per round: until ready, until the first response and the CPU
 * of Next's processes until then, and, from a start of its own, until hydrated. A first round is
 * not counted: whichever app starts first in it pays for the disk's and Node's caches, and for any
 * edit the bench left in the catalogs.
 */
export async function coldRounds(browser, apps, path, words, rounds) {
	await round(browser, apps, 0, path, words);
	const runs = Object.fromEntries(apps.map(({ name }) => [name, []]));
	for (let index = 0; index < rounds; index++) {
		const samples = await round(
			browser,
			apps,
			index % apps.length,
			path,
			words,
		);
		for (const [name, sample] of Object.entries(samples))
			runs[name].push({ round: index, ...sample });
	}
	return runs;
}

/** Each app's medians and ranges, and the pairs' differences, overall and by block. */
export function coldSummary(runs, blockSize) {
	const measures = ["ready", "page", "hydrated", "cpu"];
	const apps = Object.fromEntries(
		Object.entries(runs).map(([name, samples]) => [
			name,
			Object.fromEntries(
				measures.map((measure) => [
					measure,
					spread(samples.map((sample) => sample[measure])),
				]),
			),
		]),
	);
	const pairs = coldPairs.map(([first, second]) => {
		const of = (measure) => {
			const values = runs[first].map(
				(sample, index) => sample[measure] - runs[second][index][measure],
			);
			const blocks = [];
			for (let start = 0; start < values.length; start += blockSize)
				blocks.push(median(values.slice(start, start + blockSize)));
			return { ...spread(values), blocks, values };
		};
		return { first, second, page: of("page"), hydrated: of("hydrated") };
	});
	return { apps, pairs };
}

const whole = (ms) => Math.round(ms).toLocaleString("en");
const signed = (ms) => `${ms > 0 ? "+" : ""}${whole(ms)}`;
const range = ({ min, max }) => `${whole(min)}–${whole(max)}`;

/** Prints the summary as two tables: the apps, then the pairs. */
export function printCold({ apps, pairs }, rounds) {
	console.log(
		`\n\`next dev\` from an empty .next, from its launch until the page's first response is complete and, in a start of its own, until Chromium has hydrated it; ${rounds} rounds in rotating order, medians and ranges, ms\n`,
	);
	console.log(
		"| app | ready | first page | range | hydrated | range | CPU until the first page |",
	);
	console.log("|---|---|---|---|---|---|---|");
	for (const [name, { ready, page, hydrated, cpu }] of Object.entries(apps)) {
		console.log(
			`| ${name} | ${whole(ready.median)} | ${whole(page.median)} | ${range(page)} | ${whole(hydrated.median)} | ${range(hydrated)} | ${whole(cpu.median)} |`,
		);
	}
	console.log(
		"\nPaired by round, the first app's time less the second's: medians, ranges and each block's median, ms\n",
	);
	console.log(
		"| pair | first page | range | blocks | hydrated | range | blocks |",
	);
	console.log("|---|---|---|---|---|---|---|");
	const differences = ({ median, min, max, blocks }) =>
		`${signed(median)} | ${signed(min)} to ${signed(max)} | ${blocks.map(signed).join(", ")}`;
	for (const { first, second, page, hydrated } of pairs) {
		console.log(
			`| ${first} − ${second} | ${differences(page)} | ${differences(hydrated)} |`,
		);
	}
}
