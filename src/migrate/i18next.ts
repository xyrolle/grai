import type { ESTree } from "vite";
import {
	expressionNamespace,
	i18nextCall,
	type Lookup,
} from "./i18next-call.ts";
import {
	boundProperty,
	calledAt,
	declaratorOf,
	type Left,
	type LibraryModule,
	type ModuleView,
	memberAt,
	ownApi,
	passedOn,
	type Translator,
	writtenProperties,
} from "./library.ts";
import type { Binding, Use } from "./scopes.ts";
import { literalText, type Node } from "./syntax.ts";

/** i18next's own module and react-i18next's: the instance's `t` and the hook's, and `<Trans>`. */
export const i18nextModules: Readonly<Record<string, LibraryModule>> = {
	i18next: {
		library: "i18next",
		roles: {
			default: { kind: "translator", translator: instance },
			t: {
				kind: "translator",
				translator: (binding, module) => tOf(binding, defaults(module), module),
			},
		},
	},
	"react-i18next": {
		library: "react-i18next",
		roles: {
			useTranslation: { kind: "hook", translators: useTranslation },
			Trans: {
				kind: "component",
				element: () => ({
					left: "<Trans> renders markup and components: render the message's .parts() instead.",
				}),
			},
		},
	},
};

/** The default instance: its `t` looks in the default namespace; the rest is i18next's own. */
function instance(binding: Binding, module: ModuleView): Translator {
	return {
		binding,
		translate(use) {
			const member = memberAt(use, module.scopes);
			if (member === undefined) return passedOn(use);
			const call = calledAt(member.node, module.scopes);
			if (member.name !== "t" || call === undefined) {
				return ownApi(`${use.name}.${member.name}`, "i18next");
			}
			return i18nextCall(call, defaults(module), module);
		},
	};
}

/** `const { t } = useTranslation(ns, options)`, or `const [t] = …`: a `t` that looks where the hook says. */
function useTranslation(use: Use, module: ModuleView): Translator[] | Left {
	const call = calledAt(use, module.scopes);
	const declarator = call && declaratorOf(call, module.scopes);
	if (call === undefined || declarator === undefined) {
		return {
			left: "useTranslation's t is not given a name here, so where it is called cannot be followed.",
		};
	}
	const pattern = declarator.id;
	const first =
		pattern.type === "ArrayPattern" ? pattern.elements[0] : undefined;
	const name = boundProperty(pattern, "t") ?? first ?? undefined;
	const binding = name && module.scopes.bindingOf(name);
	if (binding === undefined) return [];
	const translator = tOf(binding, hookLookup(call, module), module);
	return [{ ...translator, declarator }];
}

/** A `t`, each call of which is a message call where the lookup says. */
function tOf(
	binding: Binding,
	lookup: Lookup | Left,
	module: ModuleView,
): Translator {
	return {
		binding,
		translate(use) {
			const call = calledAt(use, module.scopes);
			if (call === undefined) return passedOn(use);
			return "left" in lookup ? lookup : i18nextCall(call, lookup, module);
		},
	};
}

/** Where a call that names no namespace looks: i18next's default namespace. */
function defaults(module: ModuleView): Lookup {
	return {
		namespaces: [module.defaultNamespace],
		keyPrefix: "",
		locale: undefined,
	};
}

/** The lookup `useTranslation(ns, { keyPrefix, lng })` gives its `t`, when the call writes it. */
function hookLookup(
	call: ESTree.CallExpression,
	module: ModuleView,
): Lookup | Left {
	const [ns, options] = call.arguments;
	const namespaces = namespacesOf(ns, module);
	if (namespaces === undefined) return expressionNamespace;
	const written = writtenProperties(options, "options");
	if ("left" in written) return written;
	const keyPrefix = written.properties.get("keyPrefix")?.value;
	const prefix = keyPrefix === undefined ? "" : literalText(keyPrefix);
	if (prefix === undefined) {
		return {
			left: "its keyPrefix is an expression: call the message by name, as m.<key>().",
		};
	}
	const lng = written.properties.get("lng")?.value;
	const locale = lng && module.text.slice(lng.start, lng.end);
	return { namespaces, keyPrefix: prefix, locale };
}

/** The namespaces a hook's first argument names: one, a list, or the default for none. */
function namespacesOf(
	node: Node | undefined,
	module: ModuleView,
): string[] | undefined {
	if (node === undefined) return [module.defaultNamespace];
	if (node.type !== "ArrayExpression") {
		const namespace = literalText(node);
		return namespace === undefined ? undefined : [namespace];
	}
	const names = node.elements.map((element) => literalText(element));
	return names.every((name) => name !== undefined) ? names : undefined;
}
