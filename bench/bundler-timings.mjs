// Rolldown's own timing of a build's plugins (`checks.bundlerTimings`, on by default), read from the
// report it logs when a callback takes a second or more: how long JavaScript callbacks ran in all,
// and each slow callback's plugin, hook and time, as the hook's own wall time, awaits included.
// Rolldown names no callback under a second, so a build whose callbacks are all faster has none.

const duration = String.raw`([\d.]+)(ms|s)`;
const header = new RegExp(
	`JavaScript callbacks ran for ${duration} of this ${duration} build`,
);
const row = new RegExp(
	String.raw`- plugin (\S+) (\S+) \(\d+%, ${duration}, (\d+) calls?\)`,
	"g",
);

const ms = (value, unit) => Number(value) * (unit === "s" ? 1000 : 1);

/** The report in a logged message, or undefined when the message is no such report. */
export function bundlerTimings(message) {
	const head = header.exec(message);
	if (head === null) return undefined;
	const [, callbacks, callbacksUnit, build, buildUnit] = head;
	return {
		callbacksMs: ms(callbacks, callbacksUnit),
		buildMs: ms(build, buildUnit),
		hooks: [...message.matchAll(row)].map(
			([, plugin, hook, value, unit, calls]) => ({
				plugin,
				hook,
				ms: ms(value, unit),
				calls: Number(calls),
			}),
		),
	};
}
