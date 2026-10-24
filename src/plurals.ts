import { cardinalRules, ordinalRules } from "./plural-rules.ts";

/** CLDR's two kinds of plural rules: for counting (1 item), and for ranking (1st). */
export type PluralType = "cardinal" | "ordinal";

const pluralTypes: readonly PluralType[] = ["cardinal", "ordinal"];

const rulesByType: Readonly<
	Record<PluralType, Readonly<Record<string, Readonly<Record<string, string>>>>>
> = { cardinal: cardinalRules, ordinal: ordinalRules };

/** CLDR's plural categories, in its order: a locale's rules are tried in this order. */
const categoryOrder = ["zero", "one", "two", "few", "many", "other"];

/** A rule's value at compile time: JavaScript that computes it, or a boolean it always is. */
type Code = string | boolean;

/**
 * CLDR's operands, each as the code a function reads it from or the value it always has, and
 * whether n is always whole.
 */
type Operands = {
	values: Readonly<Record<string, string | number>>;
	whole: boolean;
};

/** A whole, non-negative count: n is its integer digits, and it has no fraction or exponent. */
const integerOperands: Operands = {
	values: { n: "n", i: "n", v: 0, w: 0, f: 0, t: 0, e: 0, c: 0 },
	whole: true,
};
/** Any count, split by `operands()`; a JavaScript number's fraction has no trailing zeros. */
const decimalOperands: Operands = {
	values: { n: "x", i: "i", v: "v", w: "v", f: "f", t: "f", e: 0, c: 0 },
	whole: false,
};

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

/** The name the output gives a locale's plural function of a type: `plural_en` or `ordinal_en`. */
export function pluralName(locale: string, type: PluralType): string {
	const prefix = type === "cardinal" ? "plural" : "ordinal";
	return `${prefix}_${locale.replaceAll("-", "_")}`;
}

/**
 * plurals.js: a function per locale and type giving a count's category, compiled from CLDR's
 * rules. A count is taken as a number, as Intl.PluralRules takes it. A whole, non-negative count,
 * the usual one, takes a path with the fraction and exponent operands folded away; any other is
 * split into its operands first. That path also tests the count's type, which Number.isInteger
 * implies, as TypeScript narrows by `typeof` and not by Number.isInteger, and an app's checkJs
 * reads this file.
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

${functions.join("\n")}`;
}

function pluralFunction(locale: string, type: PluralType): string {
	const rules = rulesOf(locale, type);
	const integer = chain(rules, integerOperands);
	const decimal = chain(rules, decimalOperands);
	return `/** @param {unknown} n */\nexport const ${pluralName(locale, type)} = (n) => {\n\tif (typeof n === "number" && Number.isInteger(n) && n >= 0) return ${integer};\n\tconst [x, i, v, f] = operands(Number(n));\n\treturn ${decimal};\n};\n`;
}

/** The categories' conditions as one expression, choosing the first that holds, else other. */
function chain(
	rules: Readonly<Record<string, string>>,
	operands: Operands,
): string {
	let code = '"other"';
	for (const category of categoryOrder.toReversed()) {
		const rule = rules[category];
		if (rule === undefined) continue;
		const condition = compileRule(rule, operands);
		if (condition === true) code = JSON.stringify(category);
		else if (condition !== false)
			code = `${condition} ? ${JSON.stringify(category)} : ${code}`;
	}
	return code;
}

/** Compiles a rule such as `v = 0 and i % 10 = 2..4 or n = 7`, folding the operands it knows. */
function compileRule(rule: string, operands: Operands): Code {
	return rule.split(" or ").reduce<Code>(
		(any, alternative) =>
			or(
				any,
				alternative
					.split(" and ")
					.reduce<Code>(
						(all, relation) => and(all, compileRelation(relation, operands)),
						true,
					),
			),
		false,
	);
}

const relation = /^([a-z])\s*(?:%\s*(\d+))?\s*(!=|=)\s*([\d.,]+)$/;

function compileRelation(text: string, operands: Operands): Code {
	const match = relation.exec(text.trim());
	if (match === null)
		throw new Error(`grai cannot read the CLDR plural relation "${text}"`);
	const [, name = "", modulus, operator, list = ""] = match;
	const operand = operands.values[name];
	if (operand === undefined)
		throw new Error(`grai knows no CLDR plural operand "${name}"`);
	const ranges = list.split(",").map((item): [number, number] => {
		const [low = "", high = low] = item.split("..");
		return [Number(low), Number(high)];
	});
	const negated = operator === "!=";
	if (typeof operand === "number") {
		const value = modulus === undefined ? operand : operand % Number(modulus);
		return (
			ranges.some(([low, high]) => value >= low && value <= high) !== negated
		);
	}
	const value = modulus === undefined ? operand : `${operand} % ${modulus}`;
	// A range of n holds only its whole values, and n can have a fraction.
	const whole = name === "n" && !operands.whole ? `${value} % 1 === 0 && ` : "";
	const tests = ranges.map(([low, high]) =>
		low === high
			? `${value} === ${low}`
			: `(${whole}${value} >= ${low} && ${value} <= ${high})`,
	);
	const any = tests.length === 1 ? (tests[0] ?? "") : `(${tests.join(" || ")})`;
	return negated ? `!${any.startsWith("(") ? any : `(${any})`}` : any;
}

function and(a: Code, b: Code): Code {
	if (a === false || b === false) return false;
	if (a === true) return b;
	if (b === true) return a;
	return `${a} && ${b}`;
}

function or(a: Code, b: Code): Code {
	if (a === true || b === true) return true;
	if (a === false) return b;
	if (b === false) return a;
	return `(${a} || ${b})`;
}
