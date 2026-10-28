// The texts a compiled output draws, checked after a timed compile and never inside its clock:
// every key of the reference in every locale, called through the output's messages.js with inputs
// that reach a real variant (calls.mjs), a message with markup drawn from its parts
// (call-values.mjs). The reference is Paraglide's production output's texts, which grai's must
// match and Paraglide's other layouts must too (reference-texts.mjs writes it). It imports nothing
// of either library, so that checking costs a measured process nothing before its clock.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { show } from "./call-values.mjs";

/** A key's text in a locale, from a compiled output's `m`. */
export const drawn = (m, call, locale) =>
	call.kind === "markup"
		? show(m[call.key].parts(call.inputs, { locale }))
		: m[call.key](call.inputs, { locale });

/**
 * Throws unless the output in `outdir` draws every text of the reference in `referenceFile`, with
 * `edit`, a `{ locale, key, text }` the run saved, in place of that key's text in that locale.
 */
export async function checkTexts(outdir, referenceFile, edit) {
	const { calls, texts } = JSON.parse(readFileSync(referenceFile, "utf8"));
	const { m } = await import(pathToFileURL(join(outdir, "messages.js")).href);
	for (const [locale, expected] of Object.entries(texts)) {
		calls.forEach((call, index) => {
			const edited = edit?.locale === locale && edit.key === call.key;
			const wanted = edited ? edit.text : expected[index];
			const text = drawn(m, call, locale);
			if (text !== wanted)
				throw new Error(
					`${outdir} draws ${call.key} in ${locale} as ${JSON.stringify(text)}, not ${JSON.stringify(wanted)}.`,
				);
		});
	}
}
