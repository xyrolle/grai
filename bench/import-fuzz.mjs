// Generates messages full of the characters each syntax makes special, imports them with
// `grai import`, and renders each with grai and with the library it came from, intl-messageformat
// or i18next, in English and Russian for a range of inputs. A message must render the same in
// both, or be left out by grai: as not valid only when the library rejects it too, or with the
// reason grai cannot express it. It prints every other difference, and how often each reason left
// messages out.
//   node import-fuzz.mjs [messages per format] [seed]
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { i18nextLibrary, icuLibrary } from "./fuzz-libraries.mjs";
import { graiCli } from "./grai.mjs";
import { generator } from "./synthetic.mjs";

const [count = 2000, seed = 1] = process.argv.slice(2).map(Number);
const locales = ["en", "ru"];
const inputSets = [0, 1, 2, 5, 21, 1.5].flatMap((n) =>
	["male", "other"].map((g) => ({ n, g, name: "Ana", value: n })),
);

let failed = false;
for (const library of [icuLibrary, i18nextLibrary]) {
	const random = generator(seed);
	const messages = new Map(
		Array.from({ length: count }, (_, i) => [`m${i}`, library.message(random)]),
	);
	for (const [key, text] of library.texts) messages.set(key, text);
	const { m, leftOut } = await importAll(library.format, messages);
	const tally = { equal: 0, rejected: 0, unexpressed: new Map(), differ: [] };
	for (const locale of locales) {
		const render = library.renderer(messages, locale);
		for (const [key, source] of messages) {
			const inputs = inputSets.map((base) => library.inputsOf(source, base));
			const theirs = inputs.map((given) =>
				attempt(() => render(key, source, given)),
			);
			const message = m[key] && ((given) => graiText(m[key], given, locale));
			const outcome = compare(message, leftOut.get(key), inputs, theirs);
			if (typeof outcome === "string") tally[outcome]++;
			else if (outcome.unexpressed !== undefined) {
				const times = tally.unexpressed.get(outcome.unexpressed) ?? 0;
				tally.unexpressed.set(outcome.unexpressed, times + 1);
			} else
				tally.differ.push(
					`${locale} ${JSON.stringify(source)}: ${outcome.differs}`,
				);
		}
	}
	const unexpressed = [...tally.unexpressed.values()].reduce(
		(a, b) => a + b,
		0,
	);
	console.log(
		`${library.format}: ${count} messages in ${locales.join(" and ")}, ${tally.equal} render the same, ${tally.rejected} left out that the library rejects too, ${unexpressed} left out as grai cannot express them, ${tally.differ.length} differ`,
	);
	const reasons = [...tally.unexpressed].sort(([, a], [, b]) => b - a);
	for (const [reason, times] of reasons.slice(0, 10)) {
		console.log(`  left out ${times}×: ${reason}`);
	}
	for (const line of tally.differ.slice(0, 30))
		console.log(`  differs: ${line}`);
	if (tally.differ.length > 0) failed = true;
}
process.exitCode = failed ? 1 : 0;

/**
 * How grai's import of a message, rendered by `ours` when it was imported, compares with the
 * library's renders of it: "equal", "rejected" by both, left out with the reason grai cannot
 * express it, or how it differs.
 */
function compare(ours, reason, inputs, theirs) {
	const rejected = theirs.find((rendered) => rendered instanceof Error);
	if (ours === undefined) {
		if (reason === undefined) return { differs: "grai left it out unreported" };
		if (!reason.startsWith("it is not a valid")) {
			return { unexpressed: reason.replace(/\{[^}]*\}|"[^"]*"/g, "…") };
		}
		if (rejected !== undefined) return "rejected";
		return { differs: `grai left it out: ${reason}` };
	}
	if (rejected !== undefined) {
		return { differs: `the library rejects it (${rejected.message})` };
	}
	for (const [index, given] of inputs.entries()) {
		const rendered = attempt(() => ours(given));
		if (rendered !== theirs[index]) {
			return {
				differs: `${JSON.stringify(theirs[index])} from the library, ${JSON.stringify(rendered)} from grai, for ${JSON.stringify(given)}`,
			};
		}
	}
	return "equal";
}

/** Imports the messages as each locale's catalog and compiles them: the messages, and why each left out one was. */
async function importAll(format, messages) {
	const dir = mkdtempSync(join(tmpdir(), "grai-import-fuzz-"));
	try {
		mkdirSync(join(dir, "source"));
		for (const locale of locales) {
			writeFileSync(
				join(dir, "source", `${locale}.json`),
				JSON.stringify(Object.fromEntries(messages)),
			);
		}
		writeFileSync(
			join(dir, "grai.config.json"),
			JSON.stringify({
				locales,
				baseLocale: "en",
				catalogs: "messages/{locale}.json",
				outdir: "out",
			}),
		);
		const report = execFileSync(
			process.execPath,
			[graiCli, "import", "--from", format, "source"],
			{ cwd: dir, encoding: "utf8" },
		);
		execFileSync(process.execPath, [graiCli, "compile"], { cwd: dir });
		const { m } = await import(
			pathToFileURL(join(dir, "out", "messages.js")).href
		);
		const leftOut = new Map();
		for (const [, key, why] of report.matchAll(
			/^left out: source\/\w+\.json: "([^"]+)" \([\w, ]+\): (.*)$/gm,
		)) {
			if (!leftOut.has(key)) leftOut.set(key, why);
		}
		return { m, leftOut };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** What `render` returns, or the error it throws. */
function attempt(render) {
	try {
		return render();
	} catch (error) {
		return error;
	}
}

/** A grai message's text in a locale, each markup drawn as a tag. */
function graiText(message, inputs, locale) {
	if (typeof message.parts !== "function") return message(inputs, { locale });
	return message
		.parts(inputs, { locale })
		.map((part) =>
			part.type === "text"
				? part.value
				: part.type === "markup-start"
					? `<${part.name}>`
					: `</${part.name}>`,
		)
		.join("");
}
