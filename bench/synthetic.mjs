// A catalog with app A's shape, for anyone without the apps' checkouts: 6,366 keys in ro, ru and
// en, of which 1,294 have inputs, 240 are plurals and 226 hold markup, with words of about the
// same length. The same seed always writes the same files.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEYS = 6366;
const WITH_INPUTS = 1294;
const PLURALS = 240;
const WITH_MARKUP = 226;

const syllables = {
	ro: [
		"ca",
		"re",
		"ști",
		"lu",
		"mo",
		"ne",
		"ță",
		"pri",
		"vi",
		"do",
		"ră",
		"ma",
	],
	ru: ["ка", "ре", "ст", "лу", "мо", "не", "ть", "при", "ви", "до", "ра", "ма"],
	en: ["ca", "re", "st", "lu", "mo", "ne", "th", "pri", "vi", "do", "ra", "ma"],
};

const categories = {
	ro: ["one", "few", "other"],
	ru: ["one", "few", "many", "other"],
	en: ["one", "other"],
};

/** mulberry32: a small seeded generator, so the catalog never changes between runs. */
function generator(seed) {
	let state = seed;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function sentence(random, locale, words) {
	const parts = [];
	for (let w = 0; w < words; w++) {
		const length = 1 + Math.floor(random() * 3);
		let word = "";
		for (let s = 0; s < length; s++)
			word +=
				syllables[locale][Math.floor(random() * syllables[locale].length)];
		parts.push(word);
	}
	return parts.join(" ");
}

function catalog(locale) {
	const random = generator(7);
	const entries = {
		$schema: "https://inlang.com/schema/inlang-message-format",
	};
	for (let n = 0; n < KEYS; n++) {
		const key = `area${n % 97}_part${n % 13}_message${n}`;
		const words = 3 + Math.floor(random() * 6);
		if (n < PLURALS) {
			const match = {};
			for (const category of categories[locale])
				match[`countPlural=${category}`] =
					`${sentence(random, locale, words)} {count}`;
			entries[key] = [
				{
					declarations: ["input count", "local countPlural = count: plural"],
					selectors: ["countPlural"],
					match,
				},
			];
		} else if (n < PLURALS + WITH_INPUTS) {
			entries[key] = `${sentence(random, locale, words)} {name}`;
		} else if (n < PLURALS + WITH_INPUTS + WITH_MARKUP) {
			// As app A holds it: mostly an element the app draws in the text's place, some a link.
			entries[key] =
				n % 4 === 0
					? `${sentence(random, locale, words)} {#link}${sentence(random, locale, 2)}{/link}`
					: `{#icon/} ${sentence(random, locale, words)}`;
		} else {
			entries[key] = sentence(random, locale, words);
		}
	}
	return entries;
}

/** Writes `content` to `path` unless it holds it already, so an unchanged catalog keeps its time. */
function keep(path, content) {
	if (!existsSync(path) || readFileSync(path, "utf8") !== content)
		writeFileSync(path, content);
}

/** Writes the synthetic inlang project, as this file describes it, and returns its root. */
export function writeSyntheticProject(root) {
	mkdirSync(join(root, "messages"), { recursive: true });
	mkdirSync(join(root, "project.inlang"), { recursive: true });
	for (const locale of Object.keys(categories)) {
		keep(
			join(root, "messages", `${locale}.json`),
			`${JSON.stringify(catalog(locale), null, "\t")}\n`,
		);
	}
	const settings = {
		baseLocale: "ro",
		locales: Object.keys(categories),
		"plugin.inlang.messageFormat": { pathPattern: "./messages/{locale}.json" },
	};
	keep(
		join(root, "project.inlang/settings.json"),
		`${JSON.stringify(settings, null, "\t")}\n`,
	);
	return root;
}
