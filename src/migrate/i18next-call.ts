import type { ESTree } from "vite";
import type { MappedKey, Mapping } from "../import/mapping.ts";
import {
	droppedValue,
	type Left,
	type ModuleView,
	movedLocale,
	type Outcome,
	readsTheSame,
	writtenProperties,
} from "./library.ts";
import { messageCall } from "./message-call.ts";
import { literalText, type Node } from "./syntax.ts";

/**
 * Where a `t` looks a key up. A hook loads its namespaces but looks in its first, unless its
 * nsMode is fallback; i18next's own `t` reads whatever the app's init loads.
 */
export type Lookup = {
	/** The namespaces the hook loads, or undefined for i18next's own `t`. */
	loaded: readonly string[] | undefined;
	/** Where a key that names no namespace is looked up, in order. */
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

/** What a call's options say: the namespaces it names, the suffixes its context and ordinal add, its inputs. */
type CallOptions = {
	/** The namespaces its `ns` names, which i18next looks in in order. */
	named: readonly string[] | undefined;
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
	const options = optionsOf(passed.properties, lookup, module);
	if ("left" in options) return options;
	const separator = written.indexOf(":");
	if (separator !== -1 && lookup.keyPrefix !== "") {
		return {
			left: "its key names a namespace under a keyPrefix, where i18next does not find it: call the message by name, as m.<key>().",
		};
	}
	const prefix = lookup.keyPrefix === "" ? "" : `${lookup.keyPrefix}.`;
	const path = `${prefix}${written.slice(separator + 1)}${options.suffix}`;
	const named =
		separator === -1 ? options.named : [written.slice(0, separator)];
	const namespaces = named ?? lookup.namespaces;
	const mapped = mappedIn(module.mapping, namespaces, path);
	if (mapped === undefined) return missing(module.mapping, namespaces, path);
	const unloaded = named?.find(
		(namespace) => lookup.loaded?.includes(namespace) === false,
	);
	if (unloaded !== undefined) {
		return {
			left: `it names ${unloaded}, which its useTranslation does not load: i18next finds the key only if another hook or the app's i18next init loads ${unloaded}. Call m.${mapped.key}() if one does.`,
		};
	}
	const { inputs, locale } = options;
	const object = passed.object;
	return messageCall(call, mapped, { inputs, object, locale }, module.text);
}

/**
 * A call's options: `ns` sets where it looks, `context` and `ordinal` add to its key, `lng` sets
 * its locale, a default value is never shown, as the key exists; the others are its inputs. The
 * locale moves after the inputs and a default value is dropped, so each must read the same.
 */
function optionsOf(
	properties: ReadonlyMap<string, ESTree.ObjectProperty>,
	lookup: Lookup,
	{ text, scopes }: ModuleView,
): CallOptions | Left {
	let named: readonly string[] | undefined;
	let { locale } = lookup;
	let context = "";
	let ordinal = "";
	const inputs = new Map<string, ESTree.ObjectProperty>();
	for (const [name, property] of properties) {
		const { value } = property;
		if (name === "ns") {
			named = namespaceList(value);
			if (named === undefined) return expressionNamespace;
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
			if (!readsTheSame(value, scopes)) return movedLocale;
			locale = text.slice(value.start, value.end);
		} else if (unmigratedOptions.has(name)) {
			return {
				left: `it passes i18next's ${name}, which grai has no counterpart for.`,
			};
		} else if (name === "defaultValue" || name.startsWith("defaultValue_")) {
			if (!readsTheSame(value, scopes)) return droppedValue(name);
		} else {
			inputs.set(name, property);
		}
	}
	// i18next puts a context's suffix before an ordinal's, as in friend_male_ordinal_one.
	return { named, locale, suffix: context + ordinal, inputs };
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

/** The namespaces a string or a list of strings written in the code names; undefined for another expression. */
export function namespaceList(node: Node): string[] | undefined {
	if (node.type !== "ArrayExpression") {
		const namespace = literalText(node);
		return namespace === undefined ? undefined : [namespace];
	}
	const names = node.elements.map((element) => literalText(element));
	return names.every((name) => name !== undefined) ? names : undefined;
}

/**
 * Why a key no namespace it is looked up in has stays: none has it, or only a namespace i18next
 * reaches through a fallback the codemod cannot see, which a person confirms.
 */
function missing(
	mapping: Mapping,
	namespaces: readonly string[],
	path: string,
): Left {
	const searched = new Set(
		namespaces.map((namespace) => `${namespace}:${path}`),
	);
	const elsewhere = [...mapping.keys].filter(
		([calledBy]) => calledBy.endsWith(`:${path}`) && !searched.has(calledBy),
	);
	const where = `grai.import.json has no key ${namespaces[0]}:${path}`;
	if (elsewhere.length === 0) {
		return {
			left: `${where}: the import left it out, or no catalog has it.`,
		};
	}
	const found = elsewhere.map(([calledBy]) => calledBy).join(" and ");
	const calls = elsewhere.map(([, { key }]) => `m.${key}()`).join(" or ");
	const verb = elsewhere.length === 1 ? "is" : "are";
	return {
		left: `${where}. ${found} ${verb} in it, which i18next reaches only through its fallbackNS or the hook's nsMode: "fallback": call ${calls} if the app sets one.`,
	};
}
