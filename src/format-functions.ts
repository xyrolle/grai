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

/**
 * How an option's text is read: as a count of digits, as true or false, as a count of digits or
 * `auto`, or as it is.
 */
export type OptionKind =
	| "digits"
	| "boolean"
	| "grouping"
	| "digitsOrAuto"
	| "text";

/**
 * The number a selector on a function compares, from its input: the input as a number, rounded to
 * a whole one as `:integer` shows it, or the percent `:percent` shows.
 */
export type SelectedNumber = "number" | "integer" | "percent";

/** A formatting function: its formatter, the options it takes, and what it formats with by default. */
export type FormatFunction = {
	formatter: IntlFormatter;
	options: Readonly<Record<string, OptionKind>>;
	/** Options it always formats with. */
	fixed?: IntlOptions;
	/** Options it formats with when it is given none that shape the text. */
	defaults?: IntlOptions;
	/** The option it cannot format without, such as `:currency`'s currency, with an example. */
	required?: { option: string; example: string };
	/** MessageFormat 2's options it does not take, each with the error that says why. */
	refused?: Readonly<Record<string, string>>;
	/**
	 * How a selector on it chooses: by the number it compares, and by the `select` option it then
	 * takes, or else always by the plural rules.
	 */
	selects?: { number: SelectedNumber; takesSelect: boolean };
};

/** The options that round a number to its significant digits, shared by the number functions. */
const roundingOptions: Readonly<Record<string, OptionKind>> = {
	minimumSignificantDigits: "digits",
	maximumSignificantDigits: "digits",
	roundingPriority: "text",
	roundingMode: "text",
};
const fractionDigits: Readonly<Record<string, OptionKind>> = {
	minimumFractionDigits: "digits",
	maximumFractionDigits: "digits",
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
 * MessageFormat 2's formatting functions. The number functions take MessageFormat 2's options,
 * which are Intl.NumberFormat's by the same names but `:currency`'s fractionDigits, and `:number`
 * also Intl's `style` and the options that go with it. MessageFormat 2's date and time functions
 * are a draft whose options are still changing, so `:datetime`, `:date` and `:time` take
 * Intl.DateTimeFormat's options by name, and MessageFormat 2's defaults when they are given none
 * that shape the text.
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
		selects: { number: "number", takesSelect: true },
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
		selects: { number: "integer", takesSelect: true },
	},
	percent: {
		formatter: "number",
		options: {
			signDisplay: "text",
			useGrouping: "grouping",
			...fractionDigits,
			...roundingOptions,
			trailingZeroDisplay: "text",
		},
		fixed: { style: "percent" },
		selects: { number: "percent", takesSelect: false },
	},
	currency: {
		formatter: "number",
		options: {
			currency: "text",
			currencySign: "text",
			currencyDisplay: "text",
			useGrouping: "grouping",
			minimumIntegerDigits: "digits",
			fractionDigits: "digitsOrAuto",
			...roundingOptions,
			roundingIncrement: "digits",
			trailingZeroDisplay: "text",
		},
		fixed: { style: "currency" },
		required: { option: "currency", example: "currency=EUR" },
	},
	unit: {
		formatter: "number",
		options: {
			unit: "text",
			unitDisplay: "text",
			signDisplay: "text",
			useGrouping: "grouping",
			minimumIntegerDigits: "digits",
			...fractionDigits,
			...roundingOptions,
			roundingIncrement: "digits",
		},
		fixed: { style: "unit" },
		required: { option: "unit", example: "unit=kilometer" },
		refused: {
			usage:
				"usage converts the value into the units the locale prefers, which Intl cannot do, so grai does not support it. Convert the value before the call, and leave usage out.",
		},
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
