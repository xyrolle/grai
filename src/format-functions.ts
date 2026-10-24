/**
 * MessageFormat 2's formatting functions that grai compiles, and the options each takes, by how
 * an option's text is read.
 */

/** The Intl formatter a function formats with. */
export type IntlFormatter = "number" | "datetime";

/** An option's value, as Intl takes it. */
export type OptionValue = string | number | boolean;

/** Options by name, as Intl takes them. */
export type IntlOptions = Readonly<Record<string, OptionValue>>;

/** How an option's text is read: as a count of digits, as true or false, or as it is. */
export type OptionKind = "digits" | "boolean" | "grouping" | "text";

/** A formatting function: its formatter, the options it takes, and what it formats with by default. */
export type FormatFunction = {
	formatter: IntlFormatter;
	options: Readonly<Record<string, OptionKind>>;
	/** Options it always formats with. */
	fixed?: IntlOptions;
	/** Options it formats with when it is given none that shape the text. */
	defaults?: IntlOptions;
};

/** Options that set how a date or time is written, beside its fields and styles. */
const dateTimeSettings: Readonly<Record<string, OptionKind>> = {
	calendar: "text",
	numberingSystem: "text",
	timeZone: "text",
};
const dateFields: Readonly<Record<string, OptionKind>> = {
	dateStyle: "text",
	weekday: "text",
	era: "text",
	year: "text",
	month: "text",
	day: "text",
};
const timeFields: Readonly<Record<string, OptionKind>> = {
	timeStyle: "text",
	dayPeriod: "text",
	hour: "text",
	minute: "text",
	second: "text",
	fractionalSecondDigits: "digits",
	timeZoneName: "text",
};
const hourSettings: Readonly<Record<string, OptionKind>> = {
	hour12: "boolean",
	hourCycle: "text",
};

/**
 * MessageFormat 2's formatting functions. `:number` and `:integer` take MessageFormat 2's options,
 * which are Intl.NumberFormat's by the same names, and `:number` also Intl's `style` and the options
 * that go with it. MessageFormat 2's date and time functions are a draft whose options are still
 * changing, so `:datetime`, `:date` and `:time` take Intl.DateTimeFormat's options by name, and
 * MessageFormat 2's defaults when they are given none that shape the text.
 */
export const functions: Readonly<Record<string, FormatFunction>> = {
	number: {
		formatter: "number",
		options: {
			style: "text",
			currency: "text",
			currencyDisplay: "text",
			currencySign: "text",
			unit: "text",
			unitDisplay: "text",
			notation: "text",
			compactDisplay: "text",
			numberingSystem: "text",
			signDisplay: "text",
			useGrouping: "grouping",
			minimumIntegerDigits: "digits",
			minimumFractionDigits: "digits",
			maximumFractionDigits: "digits",
			minimumSignificantDigits: "digits",
			maximumSignificantDigits: "digits",
			trailingZeroDisplay: "text",
			roundingPriority: "text",
			roundingIncrement: "digits",
			roundingMode: "text",
		},
	},
	integer: {
		formatter: "number",
		options: {
			signDisplay: "text",
			useGrouping: "grouping",
			minimumIntegerDigits: "digits",
			maximumSignificantDigits: "digits",
		},
		fixed: { maximumFractionDigits: 0 },
	},
	datetime: {
		formatter: "datetime",
		options: {
			...dateFields,
			...timeFields,
			...hourSettings,
			...dateTimeSettings,
		},
		defaults: { dateStyle: "medium", timeStyle: "short" },
	},
	date: {
		formatter: "datetime",
		options: { ...dateFields, ...dateTimeSettings },
		defaults: { dateStyle: "medium" },
	},
	time: {
		formatter: "datetime",
		options: { ...timeFields, ...hourSettings, ...dateTimeSettings },
		defaults: { timeStyle: "short" },
	},
};

/**
 * Whether an option shapes the text, as a field or a style does, rather than only setting how it
 * is written, as a time zone or an hour cycle does.
 */
export function shapesText(option: string): boolean {
	return (
		!Object.hasOwn(dateTimeSettings, option) &&
		!Object.hasOwn(hourSettings, option)
	);
}
