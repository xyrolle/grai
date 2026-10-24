import {
	categoryOrder,
	chain,
	compileRule,
	decimalOperands,
	integerOperands,
	type Operands,
} from "./plural-conditions.ts";
import { cardinalRules, ordinalRules } from "./plural-rules.ts";

/** CLDR's two kinds of plural rules: for counting (1 item), and for ranking (1st). */
export type PluralType = "cardinal" | "ordinal";

const pluralTypes: readonly PluralType[] = ["cardinal", "ordinal"];

const rulesByType: Readonly<
	Record<PluralType, Readonly<Record<string, Readonly<Record<string, string>>>>>
> = { cardinal: cardinalRules, ordinal: ordinalRules };

/** The CLDR rules of a locale: its own, else those of the language it falls back to, else none. */
function rulesOf(
	locale: string,
	type: PluralType,
): Readonly<Record<string, string>> {
	let tag = Intl.getCanonicalLocales(locale)[0] ?? locale;
	for (;;) {
		const rules = rulesByType[type][tag];
		if (rules !== undefined) return rules;
		const cut = tag.lastIndexOf("-");
		if (cut === -1) return {};
		tag = tag.slice(0, cut);
	}
}

/** A locale's plural categories of a type, other last, as CLDR names them. */
export function categoriesOf(
	locale: string,
	type: PluralType,
): readonly string[] {
	const rules = rulesOf(locale, type);
	return categoryOrder.filter(
		(category) => category === "other" || category in rules,
	);
}

/** The category CLDR's rules of a type give a whole count in a locale, worked out when compiling. */
export function categoryOf(
	locale: string,
	type: PluralType,
	count: number,
): string {
	const n = Math.abs(count);
	const operands: Operands = {
		values: { n, i: n, v: 0, w: 0, f: 0, t: 0, e: 0, c: 0 },
		whole: true,
	};
	const rules = rulesOf(locale, type);
	const holds = (category: string) => {
		const rule = rules[category];
		return rule !== undefined && compileRule(rule, operands) === true;
	};
	return categoryOrder.find(holds) ?? "other";
}

/** The name the output gives a locale's plural function of a type: `plural_en` or `ordinal_en`. */
export function pluralName(locale: string, type: PluralType): string {
	const prefix = type === "cardinal" ? "plural" : "ordinal";
	return `${prefix}_${locale.replaceAll("-", "_")}`;
}

/** The name of plurals.js's function that rounds a count as `:integer` shows it. */
export const integerName = "integer";

/**
 * plurals.js: a function per locale and type giving a count's category, compiled from CLDR's
 * rules, and `integer`, the whole number an `:integer` selector compares. A count is taken as a
 * number, as Intl.PluralRules takes it. A whole, non-negative count, the usual one, takes a path
 * with the fraction and exponent operands folded away; any other is split into its operands
 * first. That path also tests the count's type, which Number.isInteger implies, as TypeScript
 * narrows by `typeof` and not by Number.isInteger, and an app's checkJs reads this file.
 */
export function pluralModule(locales: readonly string[]): string {
	const functions = pluralTypes.flatMap((type) =>
		locales.map((locale) => pluralFunction(locale, type)),
	);
	return `// Plural rules from Unicode CLDR, © Unicode, Inc., under the Unicode License v3.

/**
 * A count's operands: its absolute value, integer digits, number of fraction digits, and fraction
 * digits, once it is rounded as Intl.PluralRules rounds it, half away from zero to three digits.
 *
 * @param {number} n
 * @returns {[x: number, i: number, v: number, f: number]}
 */
const operands = (n) => {
	const x = Math.abs(n);
	const text = String(x);
	if (text.includes("e")) return x < 1 ? [0, 0, 0, 0] : [x, x, 0, 0];
	let [whole, fraction = ""] = text.split(".");
	if (fraction.length > 3) {
		const thousandths = Number(whole + fraction.slice(0, 3)) + (fraction.charAt(3) >= "5" ? 1 : 0);
		whole = String(Math.floor(thousandths / 1000));
		fraction = String(thousandths % 1000).padStart(3, "0").replace(/0+$/, "");
	}
	return [Number(\`\${whole}.\${fraction || 0}\`), Number(whole), fraction.length, Number(fraction || 0)];
};

/**
 * A count as the whole number :integer shows: rounded half away from zero, as Intl rounds it.
 *
 * @param {unknown} n
 */
export const ${integerName} = (n) => {
	const x = Number(n);
	return Math.sign(x) * Math.round(Math.abs(x));
};

${functions.join("\n")}`;
}

/**
 * A locale's function of a type. A locale whose every count is other, such as ru's ordinals, reads
 * no count, so a bundle of it needs no operands; it still takes the count the keys' code passes,
 * as an app's checkJs counts the arguments.
 */
function pluralFunction(locale: string, type: PluralType): string {
	const name = pluralName(locale, type);
	const rules = rulesOf(locale, type);
	if (Object.keys(rules).length === 0) {
		return `/** @param {unknown} _n */\nexport const ${name} = (_n) => "other";\n`;
	}
	const integer = chain(rules, integerOperands);
	const decimal = chain(rules, decimalOperands);
	return `/** @param {unknown} n */\nexport const ${name} = (n) => {\n\tif (typeof n === "number" && Number.isInteger(n) && n >= 0) return ${integer};\n\tconst [x, i, v, f] = operands(Number(n));\n\treturn ${decimal};\n};\n`;
}
