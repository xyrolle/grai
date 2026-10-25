import type { ESTree } from "vite";
import type { MappedKey, Mapping } from "../import/mapping.ts";
import {
	type Left,
	type ModuleView,
	type Outcome,
	writtenProperties,
} from "./library.ts";
import { messageCall } from "./message-call.ts";
import { literalText } from "./syntax.ts";

/** Where a `t` looks a key up: its namespaces in order, the prefix of its keys, and its locale. */
export type Lookup = {
	namespaces: readonly string[];
	keyPrefix: string;
	locale: string | undefined;
};

/** i18next's options that change what a call renders, which grai has no counterpart for. */
const unmigratedOptions = new Set([
	"returnObjects",
	"returnDetails",
	"joinArrays",
	"postProcess",
	"interpolation",
	"replace",
	"keyPrefix",
	"nsSeparator",
	"keySeparator",
	"lngs",
	"fallbackLng",
	"skipInterpolation",
]);

const expressionKey = {
	left: "its key is an expression: call the message by name, as m.<key>().",
};
export const expressionNamespace = {
	left: "its namespace is an expression: call the message by name, as m.<key>().",
};

/** What a call's options say: where it looks, the suffixes its context and ordinal add, its inputs. */
type CallOptions = {
	namespaces: readonly string[];
	locale: string | undefined;
	suffix: string;
	inputs: Map<string, ESTree.ObjectProperty>;
};

/**
 * A call of `t(key, options)`, or of `t(key, defaultValue, options)`: its key, with its `ns:`, and
 * its options name the message; the rest of the options are its inputs.
 */
export function i18nextCall(
	call: ESTree.CallExpression,
	lookup: Lookup,
	module: ModuleView,
): Outcome {
	const [keyNode, second, third] = call.arguments;
	const written = literalText(keyNode);
	if (written === undefined) return expressionKey;
	const passed = writtenProperties(
		literalText(second) === undefined ? second : third,
		"options",
	);
	if ("left" in passed) return passed;
	const options = optionsOf(passed.properties, lookup, module.text);
	if ("left" in options) return options;
	const separator = written.indexOf(":");
	if (separator !== -1 && lookup.keyPrefix !== "") {
		return {
			left: "its key names a namespace under a keyPrefix, where i18next does not find it: call the message by name, as m.<key>().",
		};
	}
	const prefix = lookup.keyPrefix === "" ? "" : `${lookup.keyPrefix}.`;
	const path = `${prefix}${written.slice(separator + 1)}${options.suffix}`;
	const namespaces =
		separator === -1 ? options.namespaces : [written.slice(0, separator)];
	const mapped = mappedIn(module.mapping, namespaces, path);
	if (mapped === undefined) {
		return {
			left: `grai.import.json has no key ${namespaces[0]}:${path}: the import left it out, or no catalog has it.`,
		};
	}
	const { inputs, locale } = options;
	const object = passed.object;
	return messageCall(call, mapped, { inputs, object, locale }, module.text);
}

/**
 * A call's options: `ns` sets where it looks, `context` and `ordinal` add to its key, `lng` sets
 * its locale, a default value is never shown, as the key exists; the others are its inputs.
 */
function optionsOf(
	properties: ReadonlyMap<string, ESTree.ObjectProperty>,
	lookup: Lookup,
	text: string,
): CallOptions | Left {
	let { namespaces, locale } = lookup;
	let context = "";
	let ordinal = "";
	const inputs = new Map<string, ESTree.ObjectProperty>();
	for (const [name, property] of properties) {
		const { value } = property;
		if (name === "ns") {
			const namespace = literalText(value);
			if (namespace === undefined) return expressionNamespace;
			namespaces = [namespace];
		} else if (name === "context") {
			const given = literalText(value);
			if (given === undefined) {
				return {
					left: "its context is an expression: call each context's key by name.",
				};
			}
			context = `_${given}`;
		} else if (name === "ordinal") {
			if (value.type !== "Literal" || typeof value.value !== "boolean") {
				return {
					left: "its ordinal is an expression: call the plural's key, or the _ordinal one, by name.",
				};
			}
			ordinal = value.value ? "_ordinal" : "";
		} else if (name === "lng") {
			locale = text.slice(value.start, value.end);
		} else if (unmigratedOptions.has(name)) {
			return {
				left: `it passes i18next's ${name}, which grai has no counterpart for.`,
			};
		} else if (name !== "defaultValue" && !name.startsWith("defaultValue_")) {
			inputs.set(name, property);
		}
	}
	// i18next puts a context's suffix before an ordinal's, as in friend_male_ordinal_one.
	return { namespaces, locale, suffix: context + ordinal, inputs };
}

/**
 * The key in the first of the namespaces that has it, as i18next looks; or, in a mapping of files
 * without namespaces, the key itself.
 */
function mappedIn(
	mapping: Mapping,
	namespaces: readonly string[],
	path: string,
): MappedKey | undefined {
	for (const namespace of namespaces) {
		const mapped = mapping.keys.get(`${namespace}:${path}`);
		if (mapped !== undefined) return mapped;
	}
	return mapping.keys.get(path);
}
