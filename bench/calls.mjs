// What a page renders: a fixed sample of message calls drawn from the app's catalog in its own
// mix of plain text, inputs and plurals, each with inputs that reach a real variant. Every bench
// that renders messages renders this sample.
import { portable } from "./libraries.mjs";

const placeholder = /\{([^{}#/][^{}]*)\}/g;

/** Every input a message reads in any locale, and whether one of them selects a plural. */
function describe(app, key) {
	const inputs = new Map();
	let plural = false;
	for (const locale of app.locales) {
		const value = app.messages[locale][key];
		if (typeof value === "string") {
			for (const [, name] of value.matchAll(placeholder))
				if (!inputs.has(name)) inputs.set(name, "Ana");
			continue;
		}
		for (const message of value ?? []) {
			const locals = new Set();
			for (const declaration of message.declarations) {
				const local = declaration.match(/^local (\w+) = (\w+): plural$/);
				if (local) {
					locals.add(local[1]);
					inputs.set(local[2], 3);
					plural = true;
				}
			}
			const [firstMatch] = Object.keys(message.match);
			message.selectors.forEach((selector, index) => {
				const value = firstMatch.split(",")[index]?.split("=")[1];
				if (locals.has(selector) || inputs.has(selector)) return;
				if (value !== undefined && value !== "*") inputs.set(selector, value);
			});
			for (const pattern of Object.values(message.match)) {
				for (const [, name] of pattern.matchAll(placeholder))
					if (!inputs.has(name)) inputs.set(name, "Ana");
			}
		}
	}
	const kind = plural ? "plural" : inputs.size > 0 ? "inputs" : "text";
	return { key, kind, inputs: Object.fromEntries(inputs) };
}

/** A seeded shuffle, so every run and every variant renders the same calls. */
function shuffled(items) {
	const copy = [...items];
	let state = 42;
	for (let index = copy.length - 1; index > 0; index--) {
		state = (Math.imul(state, 1103515245) + 12345) >>> 0;
		const other = state % (index + 1);
		[copy[index], copy[other]] = [copy[other], copy[index]];
	}
	return copy;
}

/**
 * `count` calls in the catalog's own mix (or of one kind), repeating keys only when the catalog
 * has fewer. Plural counts cycle so every category is reached. A message the compared libraries'
 * formats cannot hold is left out, so every bench renders the same calls in every library.
 */
export function sampleCalls(app, count, kind) {
	const all = Object.keys(app.messages[app.baseLocale])
		.filter((key) => portable(app, key))
		.map((key) => describe(app, key));
	const pool = shuffled(kind ? all.filter((call) => call.kind === kind) : all);
	return Array.from({ length: count }, (_, index) => {
		const call = pool[index % pool.length];
		if (call.kind !== "plural") return call;
		const inputs = { ...call.inputs };
		for (const [name, value] of Object.entries(inputs))
			if (typeof value === "number") inputs[name] = index % 25;
		return { ...call, inputs };
	});
}

export function kindsOf(calls) {
	const counts = { text: 0, inputs: 0, plural: 0 };
	for (const call of calls) counts[call.kind]++;
	return counts;
}
