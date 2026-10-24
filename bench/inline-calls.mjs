// What one message call costs in the browser, for inline-page.mjs: a module that makes each call
// of the page's sample once, and the page script that times it.

/** A module whose `run(inputs)` makes each call once and sums the lengths of their text. */
export function callsModule(calls, alias, from) {
	const imports = [...alias].map(
		([key, name]) => `${JSON.stringify(key)} as ${name}`,
	);
	const sums = calls.map(
		(call, index) =>
			`\tn += ${alias.get(call.key)}(${call.kind === "text" ? "" : `inputs[${index}]`}).length;`,
	);
	return `import { ${imports.join(", ")} } from ${JSON.stringify(from)};
export function run(inputs) {
	let n = 0;
${sums.join("\n")}
	return n;
}
`;
}

/**
 * The page script: it runs the calls module's `count` calls in a loop, long enough for the JIT to
 * settle, and reports the median nanoseconds a call.
 */
export const callsEntry = (module, count) => `
import { run } from ${JSON.stringify(module)};
const inputs = JSON.parse(document.getElementById("props").textContent).inputs;
const round = (repeat) => {
	let produced = 0;
	const start = performance.now();
	for (let r = 0; r < repeat; r++) produced += run(inputs);
	return [performance.now() - start, produced];
};
let repeat = 1;
while (round(repeat)[0] < 20) repeat *= 2;
const warm = performance.now() + 500;
while (performance.now() < warm) round(repeat);
const samples = [];
for (let s = 0; s < 21; s++) {
	const [ms, produced] = round(repeat);
	if (produced === 0) throw new Error("the calls produced nothing");
	samples.push((ms * 1e6) / (repeat * ${count}));
}
samples.sort((a, b) => a - b);
window.bench = { ns: samples[10] };
`;
