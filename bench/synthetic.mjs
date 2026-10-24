// A catalog with app A's shape, for anyone without the apps' checkouts: 6,366 keys in ro, ru and
// en, of which 1,294 have inputs and 240 are plurals, with words of about the same length. The
// same seed always writes the same files.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const KEYS = 6366;
const WITH_INPUTS = 1294;
const PLURALS = 240;

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
		} else {
			entries[key] = sentence(random, locale, words);
		}
	}
	return entries;
}

/** Writes the synthetic inlang project once and returns its root. */
export function writeSyntheticProject(root) {
	if (existsSync(join(root, "project.inlang/settings.json"))) return root;
	mkdirSync(join(root, "messages"), { recursive: true });
	mkdirSync(join(root, "project.inlang"), { recursive: true });
	for (const locale of Object.keys(categories)) {
		writeFileSync(
			join(root, "messages", `${locale}.json`),
			`${JSON.stringify(catalog(locale), null, "\t")}\n`,
		);
	}
	const settings = {
		baseLocale: "ro",
		locales: Object.keys(categories),
		"plugin.inlang.messageFormat": { pathPattern: "./messages/{locale}.json" },
	};
	writeFileSync(
		join(root, "project.inlang/settings.json"),
		`${JSON.stringify(settings, null, "\t")}\n`,
	);
	return root;
}
