import { MessageProblem } from "../problem.ts";
import { escapeText, textOf } from "./converted.ts";
import { formatCall } from "./i18next-formats.ts";

/**
 * A grai pattern, with the inputs it reads, and those of them that i18next escapes for HTML by
 * default and that can hold text: `{{name}}` and a list, not `{{- name}}` or a number or a date.
 */
export type Pattern = {
	pattern: string;
	inputs: ReadonlySet<string>;
	escaped: ReadonlySet<string>;
};

/** A file's messages by dotted key, which `$t(key)` names. */
export type Texts = ReadonlyMap<string, unknown>;

/**
 * What one of i18next's passes fills in: its grai pattern, its text in the message, the inputs it
 * reads, and those i18next escapes.
 */
type Filled = {
	pattern: string;
	written: string;
	inputs: readonly string[];
	escaped: readonly string[];
};

/** One code unit of a message's text, or a part a pass before has filled in. */
type Slot = string | Filled;

/** A match of one of i18next's patterns in the text the passes before it left. */
type Match = {
	/** What its group holds, a placeholder's name and format or a nested key, part by part. */
	inside: readonly Slot[];
	/** The match as the message writes it. */
	written: string;
	/** Whether its text stands earlier in what this pass has left as it is. */
	standsEarlier: boolean;
};

// i18next's patterns with its default options, from its Interpolator: `{{-name}}`, then `{{name}}`,
// then `$t(key)`, each pass reading the text the one before left.
const unescapedPlaceholder = /\{\{-(.+?)\}\}/dg;
const placeholder = /\{\{(.+?)\}\}/dg;
const nesting =
	/\$t\(((?:[^()"']|"[^"]*"|'[^']*'|\((?:[^()"']|"[^"]*"|'[^']*')*\))*?)\)/dg;
/**
 * A filled-in part as a later pass reads it: one character none of the patterns reads as syntax,
 * as a value without braces, parentheses, quotes or line breaks is to them.
 */
const valueStandIn = "_";
const inputName = /^[A-Za-z_$][\w$]*$/;
/** How deep `$t()` may nest before the import stops following it, as i18next does. */
const nestingLimit = 10;

/**
 * An i18next string as a grai pattern, read in i18next's passes: `{{-name}}`, then `{{name}}`,
 * each a placeholder, `{{value, number}}` and i18next's other built-in formats one that formats
 * alike, then `$t(key)`, the text of a message of the same file without inputs. Other formats,
 * nested values and `$t()` with options throw a MessageProblem.
 */
export function patternOf(value: unknown, texts: Texts, depth = 0): Pattern {
	const text = textOf(value).split("");
	const interpolated = fill(
		fill(text, unescapedPlaceholder, (match) => placeholderOf(match, false)),
		placeholder,
		(match) => placeholderOf(match, true),
	);
	const slots = fill(interpolated, nesting, (match) =>
		nestedOf(match, texts, depth),
	);
	return {
		pattern: slots.map(patternPart).join(""),
		inputs: new Set(
			slots.flatMap((slot) => (typeof slot === "string" ? [] : slot.inputs)),
		),
		escaped: new Set(
			slots.flatMap((slot) => (typeof slot === "string" ? [] : slot.escaped)),
		),
	};
}

/**
 * One of i18next's passes: each match of `pattern` in the message, as the passes before left it,
 * filled in as `filling` reads it, or left as it is written when `filling` returns nothing.
 */
function fill(
	slots: readonly Slot[],
	pattern: RegExp,
	filling: (match: Match) => Filled | undefined,
): Slot[] {
	const text = slots.map(passText).join("");
	const filled: Slot[] = [];
	const leftAsWritten: string[] = [];
	let last = 0;
	for (const match of text.matchAll(pattern)) {
		const end = match.index + match[0].length;
		const [from, to] = match.indices?.[1] ?? [end, end];
		const before = slots.slice(last, match.index);
		const part = filling({
			inside: slots.slice(from, to),
			written: slots.slice(match.index, end).map(writtenText).join(""),
			standsEarlier: [...leftAsWritten, ...textRuns(before)].some((run) =>
				run.includes(match[0]),
			),
		});
		if (part === undefined) continue;
		leftAsWritten.push(...textRuns(before));
		filled.push(...before, part);
		last = end;
	}
	filled.push(...slots.slice(last));
	return filled;
}

/**
 * A `{{name}}`, `{{-name}}` or `{{name, format}}` as a grai placeholder, which i18next escapes when
 * `escapes` and it shows text: as itself, or a list.
 */
function placeholderOf(
	{ inside, written, standsEarlier }: Match,
	escapes: boolean,
): Filled | undefined {
	const comma = inside.indexOf(",");
	const read = comma === -1 ? inside : inside.slice(0, comma);
	// A name made with a value is none a call passes, and i18next leaves the placeholder as written.
	if (read.some(isFilled)) return undefined;
	// i18next fills a placeholder by replacing the first text like it: here an earlier copy.
	if (standsEarlier) {
		throw new MessageProblem(
			"unsupported",
			`${written} stands earlier too, in text i18next leaves as written, and i18next fills that one instead. Write the earlier text another way.`,
		);
	}
	const name = inputOf(textOfSlots(read).trim(), written);
	const format =
		comma === -1 ? "" : textOfSlots(inside.slice(comma + 1)).trim();
	const call = format === "" ? "" : ` ${formatCall(format, written)}`;
	const showsText = format === "" || format.startsWith("list");
	return {
		pattern: `{${name}${call}}`,
		written,
		inputs: [name],
		escaped: escapes && showsText ? [name] : [],
	};
}

function inputOf(name: string, written: string): string {
	if (!inputName.test(name)) {
		throw new MessageProblem(
			"unsupported",
			`${written} reads ${name.includes(".") ? "a value nested in an input" : "an input whose name is not a JavaScript identifier"}, which grai does not support. Pass it as one input, such as {{name}}.`,
		);
	}
	return name;
}

/** A `$t(key)` as the text of that message, which must have no inputs, inlined. */
function nestedOf(
	{ inside, written }: Match,
	texts: Texts,
	depth: number,
): Filled {
	const key = textOfSlots(inside).trim();
	if (key.includes(",")) {
		throw new MessageProblem(
			"unsupported",
			`${written} passes options or a format to the nested message, which grai does not support. Write its text here, or call that message where this one is used.`,
		);
	}
	if (inside.some(isFilled)) {
		throw new MessageProblem(
			"unsupported",
			`${written} nests a key made with an input's value, which grai does not support. Write its text here.`,
		);
	}
	const target = texts.get(key);
	if (target === undefined || depth >= nestingLimit) {
		throw new MessageProblem(
			"unsupported",
			`${written} nests ${target === undefined ? "a key that is not a text in the same file" : "messages too deep, or in a cycle"}. Write its text here.`,
		);
	}
	const { pattern, inputs } = patternOf(target, texts, depth + 1);
	if (inputs.size > 0) {
		throw new MessageProblem(
			"unsupported",
			`${written} nests a message with inputs, which grai does not support. Write its text here.`,
		);
	}
	return { pattern, written, inputs: [], escaped: [] };
}

/** The stretches of text between the filled-in parts of the slots. */
function textRuns(slots: readonly Slot[]): string[] {
	const runs: string[] = [];
	let run = "";
	for (const slot of slots) {
		if (typeof slot === "string") {
			run += slot;
		} else {
			runs.push(run);
			run = "";
		}
	}
	runs.push(run);
	return runs;
}

function isFilled(slot: Slot): slot is Filled {
	return typeof slot !== "string";
}

/** The slots as the message writes them. */
function textOfSlots(slots: readonly Slot[]): string {
	return slots.map(writtenText).join("");
}

/** A slot as the next pass reads it. */
function passText(slot: Slot): string {
	return typeof slot === "string" ? slot : valueStandIn;
}

/** A slot as the message writes it. */
function writtenText(slot: Slot): string {
	return typeof slot === "string" ? slot : slot.written;
}

/** A slot in grai's pattern: its text escaped, or what it was filled in with. */
function patternPart(slot: Slot): string {
	return typeof slot === "string" ? escapeText(slot) : slot.pattern;
}
