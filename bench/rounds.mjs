// Rounds: a bench measures each variant it compares once a round, in an order that rotates by one
// place from one round to the next, the rounds a multiple of the variants so that each takes every
// place alike. Each round is kept with the one-minute load it started at. A variant's figure is the
// median of its rounds, and its ratio to the reference's, grai's, is taken round by round, so that
// load the two measurements of a round share cancels out; the ratio's interval comes from the
// rounds. In Node, each measurement runs in a process of its own (`inProcess`), so that no variant
// runs on another's JIT feedback, heap or caches.
import { execFileSync } from "node:child_process";
import { loadavg } from "node:os";
import { median, medianInterval } from "./medians.mjs";

/**
 * How many rounds a bench of `variants` runs: `ROUNDS` from the environment, else `cycles` times
 * the variants. A multiple of the variants either way.
 */
export function roundCount(variants, cycles = 1) {
	const rounds = Number(process.env.ROUNDS ?? variants * cycles);
	if (!Number.isInteger(rounds) || rounds < 1 || rounds % variants !== 0)
		throw new Error(
			`ROUNDS is ${process.env.ROUNDS}: a multiple of ${variants}, the variants, gives each variant every place in the order alike.`,
		);
	return rounds;
}

/** The variants in the order of round `round`: rotated by one place a round. */
export function rotated(variants, round) {
	const first = round % variants.length;
	return [...variants.slice(first), ...variants.slice(0, first)];
}

/**
 * Measures each variant once a round, as `measure(variant, round)` measures it, in the round's
 * order. Returns each round: the load it started at, its order, and each variant's measurement.
 */
export async function inRounds(variants, rounds, measure) {
	const kept = [];
	for (let round = 0; round < rounds; round++) {
		const load = loadavg()[0];
		const order = rotated(variants, round);
		const measured = new Map();
		for (const variant of order)
			measured.set(variant, await measure(variant, round));
		kept.push({ load, order, measured });
	}
	return kept;
}

/** What results record of the rounds: each one's load and order. */
export const roundsRecord = (kept) =>
	kept.map(({ load, order }) => ({ load, order }));

/** How long one measurement in a process of its own may take: its variant's cells take seconds. */
const PATIENCE_MS = 600_000;

/**
 * Runs `script` with `args` in a new Node process, as a production server runs it, and returns
 * the JSON it printed last.
 */
export function inProcess(script, args) {
	const output = execFileSync(process.execPath, [script, ...args], {
		encoding: "utf8",
		env: { ...process.env, NODE_ENV: "production" },
		stdio: ["ignore", "pipe", "inherit"],
		maxBuffer: 1 << 26,
		timeout: PATIENCE_MS,
	});
	return JSON.parse(output.trim().split("\n").at(-1));
}

/**
 * A variant's figures round by round against the reference's in the same rounds: each round's
 * ratio, and their median with its interval. Above 1, the reference took less.
 */
export function pairedRatio(figures, references) {
	const rounds = figures.map((figure, round) => figure / references[round]);
	return { median: median(rounds), ...medianInterval(rounds), rounds };
}

/** A paired ratio as a table writes it: "14.2× (13.1× to 15.0×)". */
export function ratioText({ median, low, high }) {
	const times = (ratio) =>
		`${ratio < 10 ? ratio.toFixed(2) : ratio.toFixed(1)}×`;
	return `${times(median)} (${times(low)} to ${times(high)})`;
}
