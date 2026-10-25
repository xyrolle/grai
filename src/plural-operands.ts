/**
 * How plurals.js splits a count into the operands CLDR's rules read: a number alone, or also the
 * digits a rounding number selector shows, whose trailing zeros count. A project without such a
 * selector gets the first, and pays nothing for the second.
 */

import {
	decimalOperands,
	type Operands,
	shownOperands,
} from "./plural-conditions.ts";

/**
 * A way of splitting: the operands a function's rules read, the order of the tuple `operands()`
 * gives them in, the argument a function passes it, and its code.
 */
export type Splitting = {
	operands: Operands;
	names: readonly string[];
	argument: string;
	code: string;
};

/** A count's operands, as `name`: rounded as Intl.PluralRules rounds a number. */
const countOperands = (name: string) => `/**
 * A count's operands: its absolute value, integer digits, number of fraction digits, and fraction
 * digits, once it is rounded as Intl.PluralRules rounds it, half away from zero to three digits.
 *
 * @param {number} n
 * @returns {[x: number, i: number, v: number, f: number]}
 */
const ${name} = (n) => {
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
`;

const digitOperands = `/**
 * The operands of a count, or of the digits a rounding :number shows, such as "1.50", read as
 * written: those of a count, and the number of fraction digits and the fraction digits without
 * trailing zeros, which only shown digits have.
 *
 * @param {unknown} n
 * @returns {[x: number, i: number, v: number, w: number, f: number, t: number]}
 */
const operands = (n) => {
	if (typeof n !== "string") {
		const [x, i, v, f] = countOperands(Number(n));
		return [x, i, v, v, f, f];
	}
	const [whole = "", fraction = ""] = n.replace("-", "").split(".");
	const trimmed = fraction.replace(/0+$/, "");
	return [Math.abs(Number(n)), Number(whole), fraction.length, trimmed.length, Number(fraction || 0), Number(trimmed || 0)];
};
`;

/** A number's operands, whose fraction has no trailing zeros. */
export const countSplitting: Splitting = {
	operands: decimalOperands,
	names: ["x", "i", "v", "f"],
	argument: "Number(n)",
	code: countOperands("operands"),
};

/** A number's operands, or shown digits', whose trailing zeros count. */
export const digitSplitting: Splitting = {
	operands: shownOperands,
	names: ["x", "i", "v", "w", "f", "t"],
	argument: "n",
	code: `${countOperands("countOperands")}\n${digitOperands}`,
};
