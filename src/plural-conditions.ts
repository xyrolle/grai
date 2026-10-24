/**
 * CLDR's plural rules compiled into JavaScript conditions on a count's operands, folding away the
 * operands a path of the function already knows.
 */

/** CLDR's plural categories, in its order: a locale's rules are tried in this order. */
export const categoryOrder: readonly string[] = [
	"zero",
	"one",
	"two",
	"few",
	"many",
	"other",
];

/** A rule's value at compile time: JavaScript that computes it, or a boolean it always is. */
type Code = string | boolean;

/**
 * CLDR's operands, each as the code a function reads it from or the value it always has, and
 * whether n is always whole.
 */
export type Operands = {
	values: Readonly<Record<string, string | number>>;
	whole: boolean;
};

/** A whole, non-negative count: n is its integer digits, and it has no fraction or exponent. */
export const integerOperands: Operands = {
	values: { n: "n", i: "n", v: 0, w: 0, f: 0, t: 0, e: 0, c: 0 },
	whole: true,
};
/** Any count, split by `operands()`; a JavaScript number's fraction has no trailing zeros. */
export const decimalOperands: Operands = {
	values: { n: "x", i: "i", v: "v", w: "v", f: "f", t: "f", e: 0, c: 0 },
	whole: false,
};

/** The categories' conditions as one expression, choosing the first that holds, else other. */
export function chain(
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
export function compileRule(rule: string, operands: Operands): Code {
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
