// What each refactoring command must have done on refactor.mjs's project, checked exactly once its
// clock has stopped: check's problems and untranslated keys, every line find prints, every file
// rename leaves, and what check --fix removes and the verdict of its check. A project's files are
// its snapshot (refactor-project.mjs): each source file and catalog by its path, with its text.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { placeOf } from "./refactor-project.mjs";

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const count = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const sorted = (values) => values.map((each) => JSON.stringify(each)).sort();

/** The line of `text` that holds `index`. */
function lineAt(text, index) {
	const start = text.lastIndexOf("\n", index - 1) + 1;
	const end = text.indexOf("\n", index);
	return text.slice(start, end === -1 ? text.length : end);
}

/**
 * What find prints for `key` in a project whose code names it only where it reads it, as the
 * synthetic project's does: the key's entry in each catalog, at its opening quote, then every place
 * a source file names it, by file and position, then how many of each.
 */
export function foundLines(files, catalogs, key) {
	const place = (file, text, index) =>
		`${file}:${placeOf(text, index)}: ${lineAt(text, index).trim()}`;
	const entry = new RegExp(`^\\s*"${escaped(key)}":`, "m");
	const entries = catalogs.map((file) => {
		const text = files.get(file);
		const { index, 0: matched } = entry.exec(text);
		return place(file, text, index + matched.indexOf('"'));
	});
	const named = new RegExp(`\\b${escaped(key)}\\b`, "g");
	const sites = [...files.keys()]
		.filter((file) => !catalogs.includes(file))
		.sort()
		.flatMap((file) => {
			const text = files.get(file);
			return [...text.matchAll(named)].map(({ index }) =>
				place(file, text, index),
			);
		});
	return [
		...entries,
		...sites,
		`grai: "${key}" is in ${count(entries.length, "catalog")} and ${count(sites.length, "call site")}`,
	];
}

/** The offset in `text` of a place grai prints, `line` and `column` from 1. */
function offsetOf(text, line, column) {
	let start = 0;
	for (let at = 1; at < line; at++) start = text.indexOf("\n", start) + 1;
	return start + column - 1;
}

/**
 * The project's files once `key` is renamed `renamed` at exactly the places find printed, in a
 * catalog the key inside its entry's quotes, every other byte as it was.
 */
export function renamedFiles(files, found, key, renamed) {
	const places = new Map();
	for (const line of found.slice(0, -1)) {
		const [, file, row, column] = /^(.+?):(\d+):(\d+): /.exec(line);
		const text = files.get(file);
		let index = offsetOf(text, Number(row), Number(column));
		if (text.startsWith(`"${key}"`, index)) index++;
		if (!text.startsWith(key, index))
			throw new Error(`find printed ${line}, where ${file} has no ${key}`);
		places.set(file, [...(places.get(file) ?? []), index]);
	}
	const renamedTexts = new Map(files);
	for (const [file, indices] of places) {
		let text = files.get(file);
		for (const index of indices.sort((a, b) => b - a))
			text = text.slice(0, index) + renamed + text.slice(index + key.length);
		renamedTexts.set(file, text);
	}
	return renamedTexts;
}

/** Throws unless each file in `dir` has the text `files` gives it, naming the first that does not. */
export function assertFiles(dir, files, after) {
	for (const [file, text] of files)
		if (readFileSync(join(dir, file), "utf8") !== text)
			throw new Error(`${file} is not as it should be after ${after}.`);
}

/** A problem as the bench compares it: what and where, without its prose. */
const problemOf = ({ code, file, key, locale }) => ({
	code,
	file,
	key,
	locale,
});

/** What a run of `check --json` found: its problems and the untranslated keys. */
export function checkedOf(run) {
	const { problems, untranslated } = JSON.parse(run.stdout);
	return { problems: problems.map(problemOf), untranslated };
}

/** Throws unless a run of `check --json` found exactly `checked`, with the exit code that says so. */
export function assertChecked(run, checked) {
	const found = checkedOf(run);
	const status = checked.problems.length > 0 ? 1 : 0;
	if (
		run.status !== status ||
		sorted(found.problems).join() !==
			sorted(checked.problems.map(problemOf)).join() ||
		JSON.stringify(found.untranslated) !== JSON.stringify(checked.untranslated)
	)
		throw new Error(
			`check exited ${run.status} with ${JSON.stringify(found)}, not ${status} with ${JSON.stringify(checked)}.`,
		);
}

/** Throws unless a run of find printed exactly `found`. */
export function assertFound(run, found) {
	const printed = run.stdout.trimEnd().split("\n");
	if (run.status !== 0 || printed.join("\n") !== found.join("\n"))
		throw new Error(
			`find exited ${run.status} printing\n${run.stdout}\nnot\n${found.join("\n")}`,
		);
}

/**
 * Throws unless check --fix removed exactly the `unused` keys and then checked, its verdict the
 * `checked` problems': exit code 1 and how many there are, or 0.
 */
export function assertFixed(run, unused, checked) {
	const removed = run.stdout
		.split("\n")
		.filter((line) => line.startsWith("removed: "));
	const expected = unused.map((key) => `removed: "${key}" from every catalog`);
	if (sorted(removed).join() !== sorted(expected).join())
		throw new Error(
			`check --fix removed\n${removed.join("\n")}\nnot ${unused.length} keys added unused.`,
		);
	const problems = checked.problems.length;
	const verdict =
		problems > 0 ? `grai: ${count(problems, "error")}` : "grai: no problems";
	const printed = problems > 0 ? run.stderr : run.stdout;
	if (
		run.status !== (problems > 0 ? 1 : 0) ||
		!printed.trimEnd().endsWith(verdict)
	)
		throw new Error(
			`check --fix exited ${run.status} with ${JSON.stringify(printed.trimEnd().split("\n").at(-1))}, not with ${JSON.stringify(verdict)}.`,
		);
}
