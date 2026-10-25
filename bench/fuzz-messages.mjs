// Messages for import-fuzz.mjs, drawn from a seeded generator: each syntax's own constructs, with
// the characters it makes special, and grai's `\`, `{` and `}`, scattered through their text. Some
// come out invalid, which is the point: the import must then leave them out, as the library rejects
// them.

/** Text pieces of an ICU message: its apostrophes, alone and quoting, `#`, `<`, `>` and tags. */
const icuTexts = [
	"a",
	" ",
	"x y",
	"it's",
	"'",
	"''",
	"#",
	"<",
	">",
	"|",
	"\\",
	"'{",
	"'}",
	"'#",
	"'<",
	"'>",
	"'|",
	"<b/>",
	"<b />",
	"=",
	",",
];
/** Pieces that mostly break an ICU message where they land, so the import must leave it out. */
const icuBreakers = ["{", "}", "</b>"];

/** An ICU message: text, arguments, `#`, choices with offsets and tags, a little garbled. */
export function icuMessage(random) {
	return garbled(random, icuPattern(random, 0), [...icuTexts, ...icuBreakers]);
}

function icuPattern(random, depth) {
	return Array.from({ length: 1 + Math.floor(random() * 4) }, () => {
		const roll = random();
		if (roll < 0.45) return pick(random, icuTexts) + pick(random, icuTexts);
		if (roll < 0.6)
			return pick(random, ["{name}", "{ n }", "{n, number}", "{value}"]);
		if (roll < 0.7) return "#";
		if (roll < 0.88 && depth < 2) return icuChoice(random, depth + 1);
		const tag = pick(random, ["b", "i"]);
		return `<${tag}>${icuPattern(random, depth + 1)}</${tag}>`;
	}).join("");
}

function icuChoice(random, depth) {
	const kind = pick(random, ["plural", "plural", "select", "selectordinal"]);
	const keys =
		kind === "select"
			? ["male", "female", "other"]
			: ["=0", "=1", "one", "two", "few", "other"];
	const chosen = keys.filter((key) => key === "other" || random() < 0.4);
	const options = chosen.map((key) => `${key} {${icuPattern(random, depth)}}`);
	const offset = kind !== "select" && random() < 0.2 ? ["offset:1"] : [];
	return `{${kind === "select" ? "g" : "n"}, ${kind}, ${[...offset, ...options].join(" ")}}`;
}

/** Text pieces of an i18next message: its interpolation, nesting and format syntax, in part. */
const i18nextTexts = [
	"a",
	" ",
	"x y",
	"{",
	"}",
	"\\",
	"{{",
	"}}",
	"$t(",
	")",
	"(",
	"-",
	",",
	"$",
	"'",
	'"',
];

/** An i18next message: text, placeholders, formats and `$t(title)`, a little garbled. */
export function i18nextMessage(random) {
	const pieces = Array.from({ length: 1 + Math.floor(random() * 5) }, () =>
		random() < 0.5
			? pick(random, i18nextTexts) + pick(random, i18nextTexts)
			: pick(random, [
					"{{name}}",
					"{{ name }}",
					"{{- name}}",
					"{{-name}}",
					"{{value, number}}",
					"$t(title)",
				]),
	);
	return garbled(random, pieces.join(""), i18nextTexts);
}

/** The message, with a piece put in or a character taken out at a random place, now and then. */
function garbled(random, message, texts) {
	const roll = random();
	const at = Math.floor(random() * (message.length + 1));
	if (roll < 0.25)
		return message.slice(0, at) + pick(random, texts) + message.slice(at);
	if (roll < 0.35) return message.slice(0, at) + message.slice(at + 1);
	return message;
}

function pick(random, choices) {
	return choices[Math.floor(random() * choices.length)];
}
