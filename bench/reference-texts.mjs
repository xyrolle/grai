// The texts a compiled output and a built page are checked against: every key of the app once, each
// with inputs that reach a real variant (calls.mjs), and its text in each locale as Paraglide's
// production output draws it in Node, a message with markup drawn from its parts
// (compiled-texts.mjs). grai's texts must be the same, and so must Paraglide's in its other layouts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { sampleCalls } from "./calls.mjs";
import { drawn } from "./compiled-texts.mjs";
import { paraglideOutput } from "./paraglide.mjs";

/** Every key the libraries' formats share, once each, with its inputs. */
export function everyKey(app) {
	const keys = Object.keys(app.messages[app.baseLocale]).length;
	const calls = sampleCalls(app, keys);
	return [...new Map(calls.map((call) => [call.key, call])).values()];
}

/** The calls' texts in each locale, by locale. */
export async function referenceTexts(app, calls) {
	const { m } = await import(join(await paraglideOutput(app), "messages.js"));
	return Object.fromEntries(
		app.locales.map((locale) => [
			locale,
			calls.map((call) => drawn(m, call, locale)),
		]),
	);
}

/** Writes every key's reference into `file`, for compiled-texts.mjs; returns the calls. */
export async function writeReference(app, file) {
	const calls = everyKey(app);
	const texts = await referenceTexts(app, calls);
	writeFileSync(file, JSON.stringify({ calls, texts }));
	return calls;
}
