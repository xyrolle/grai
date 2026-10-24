import { hash } from "node:crypto";
import { MessageProblem } from "./problem.ts";

/** How a value is shown: through an Intl formatter, with the options Intl takes. */
export type Format = {
	formatter: "number" | "datetime";
	options: Readonly<Record<string, OptionValue>>;
};

type OptionValue = string | number | boolean;

/** How an option's text is read: as a count of digits, as true or false, or as it is. */
type OptionKind = "digits" | "boolean" | "grouping" | "text";

/** A formatting function: its formatter, the options it takes, and what it formats with by default. */
type FormatFunction = {
	formatter: Format["formatter"];
	options: Readonly<Record<string, OptionKind>>;
	/** Options it always formats with. */
	fixed?: Format["options"];
	/** Options it formats with when it is given none that shape the text. */
	defaults?: Format["options"];
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
const functions: Readonly<Record<string, FormatFunction>> = {
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

const option = /^([A-Za-z]\w*)=(\S+)$/;

/**
 * The format a function call asks for, such as `:number` with `minimumFractionDigits=2`, checked
 * by making its formatter once: whether Intl takes the options does not depend on the locale.
 * `source` is the call as written, for the errors.
 */
export function parseFormat(
	name: string,
	optionsText: string,
	source: string,
): Format {
	const spec = functions[name];
	if (spec === undefined) {
		throw new MessageProblem(
			"unsupported",
			`${source} calls :${name}, which grai does not support; the formatting functions are ${Object.keys(
				functions,
			)
				.map((known) => `:${known}`)
				.join(", ")}.`,
		);
	}
	const given: Record<string, OptionValue> = {};
	for (const token of optionsText.trim().split(/\s+/).filter(Boolean)) {
		const [, key = "", text = ""] = option.exec(token) ?? [];
		const kind = spec.options[key];
		if (kind === undefined || Object.hasOwn(given, key)) {
			throw new MessageProblem(
				"message-invalid",
				`${source}: "${token}" is not an option of :${name}, or is given twice. Its options are ${Object.keys(spec.options).join(", ")}.`,
			);
		}
		given[key] = optionValue(kind, text, source, token);
	}
	const shaped = Object.keys(given).some(
		(key) =>
			!Object.hasOwn(dateTimeSettings, key) &&
			!Object.hasOwn(hourSettings, key),
	);
	const options = {
		...(shaped ? {} : spec.defaults),
		...given,
		...spec.fixed,
	};
	const format: Format = { formatter: spec.formatter, options };
	try {
		if (format.formatter === "number") {
			new Intl.NumberFormat(undefined, options);
		} else {
			new Intl.DateTimeFormat(undefined, options);
		}
	} catch (error) {
		throw new MessageProblem(
			"message-invalid",
			`${source}: Intl cannot format with these options: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
	return format;
}

function optionValue(
	kind: OptionKind,
	text: string,
	source: string,
	token: string,
): OptionValue {
	if (kind === "text") return text;
	if (kind === "digits" && /^\d+$/.test(text)) return Number(text);
	if (kind === "boolean" && (text === "true" || text === "false")) {
		return text === "true";
	}
	if (kind === "grouping")
		return text === "never" || text === "false" ? false : text;
	throw new MessageProblem(
		"message-invalid",
		`${source}: "${token}" needs ${kind === "digits" ? "a whole number" : "true or false"}.`,
	);
}

/** A formatter of the output: a format in a locale, under the name formats.js exports it by. */
export type Formatter = { name: string; locale: string; format: Format };

/** A format's formatter in a locale. Its name is the same for the same locale and options. */
export function formatterOf(locale: string, format: Format): Formatter {
	const options = Object.keys(format.options).sort();
	const suffix =
		options.length === 0
			? ""
			: `_${hash("sha1", JSON.stringify(options.map((key) => [key, format.options[key]]))).slice(0, 8)}`;
	return {
		name: `${format.formatter}_${locale.replaceAll("-", "_")}${suffix}`,
		locale,
		format,
	};
}

/**
 * formats.js: each formatter the messages call, as a function of the value. The Intl formatter is
 * made the first time it formats, so a locale nobody reads makes none. A value is taken as a
 * number, as Intl takes a date by its time value.
 */
export function formatModule(formatters: Iterable<Formatter>): string {
	const byName = new Map<string, Formatter>();
	for (const formatter of formatters) {
		const named = byName.get(formatter.name);
		if (
			named !== undefined &&
			JSON.stringify(named.format) !== JSON.stringify(formatter.format)
		) {
			throw new Error(`grai gave two formats the name ${formatter.name}`);
		}
		byName.set(formatter.name, formatter);
	}
	const constructors = {
		number: "Intl.NumberFormat",
		datetime: "Intl.DateTimeFormat",
	};
	const definitions = [...byName.values()]
		.sort((a, b) => (a.name < b.name ? -1 : 1))
		.map(({ name, locale, format }) => {
			const made = `${name}_made`;
			const intl = constructors[format.formatter];
			const options =
				Object.keys(format.options).length === 0
					? ""
					: `, ${JSON.stringify(format.options)}`;
			return `/** @type {${intl} | undefined} */
let ${made};
/** @param {unknown} value */
export const ${name} = (value) =>
	(${made} ??= new ${intl}(${JSON.stringify(locale)}${options})).format(Number(value));
`;
		});
	return `// The Intl formatters the messages call, each made the first time it formats.\n\n${definitions.join("\n")}`;
}
