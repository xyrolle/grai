import type { ESTree } from "../code/parse.ts";
import type { Binding, Use } from "../code/scopes.ts";
import { literalText, type Node, propertiesOf } from "../code/syntax.ts";
import {
	calledAt,
	declaratorOf,
	type Left,
	type LibraryModule,
	type ModuleView,
	memberAt,
	movedLocale,
	type Outcome,
	passedOn,
	readsTheSame,
	type Translator,
	writtenProperties,
} from "./library.ts";
import { messageCall } from "./message-call.ts";

/** Where a `t` looks a key up: under its namespace, if it has one, in its locale, if it names one. */
type Scope = { namespace: string; locale: Node | undefined };

/** What next-intl's `t` has beside its call, and why a use of each stays. */
const members: ReadonlyMap<string, string> = new Map([
	["rich", "renders markup: render the message's .parts() instead."],
	["markup", "renders markup: render the message's .parts() instead."],
	["raw", "is next-intl's own: grai's messages are functions, never raw text."],
	["has", "is next-intl's own: grai fails the build on a missing key instead."],
]);

/** next-intl's `useTranslations` and its server's `getTranslations`, each giving a `t`. */
export const nextIntlModules: Readonly<Record<string, LibraryModule>> = {
	"next-intl": {
		library: "next-intl",
		roles: {
			useTranslations: {
				kind: "hook",
				translators: (use, module) =>
					translatorsOf(use, module, (call) =>
						namespaceScope(call.arguments[0]),
					),
			},
		},
	},
	"next-intl/server": {
		library: "next-intl",
		roles: {
			getTranslations: {
				kind: "hook",
				translators: (use, module) =>
					translatorsOf(use, module, (call) => serverScope(call, module)),
			},
		},
	},
};

/** `const t = useTranslations(ns)`, or `const t = await getTranslations(…)`: a `t` under its scope. */
function translatorsOf(
	use: Use,
	module: ModuleView,
	scopeOf: (call: ESTree.CallExpression) => Scope | Left,
): Translator[] | Left {
	const call = calledAt(use, module.scopes);
	const declarator = call && declaratorOf(call, module.scopes);
	const binding =
		declarator?.id.type === "Identifier"
			? module.scopes.bindingOf(declarator.id)
			: undefined;
	if (call === undefined || declarator === undefined || binding === undefined) {
		return {
			left: `${use.name}'s t is not given a name here, so where it is called cannot be followed.`,
		};
	}
	return [{ ...tOf(binding, scopeOf(call), module), declarator }];
}

/** A `t`: each call of it is a message call under its scope; its members are next-intl's own. */
function tOf(
	binding: Binding,
	scope: Scope | Left,
	module: ModuleView,
): Translator {
	return {
		binding,
		translate(use) {
			const member = memberAt(use, module.scopes);
			if (member !== undefined) {
				const why = members.get(member.name);
				if (why === undefined) return passedOn(use);
				return { left: `${use.name}.${member.name} ${why}` };
			}
			const call = calledAt(use, module.scopes);
			if (call === undefined) return passedOn(use);
			return "left" in scope ? scope : nextIntlCall(call, scope, module);
		},
	};
}

/** The scope a hook's namespace argument gives: none, or a namespace written in the call. */
function namespaceScope(node: Node | undefined): Scope | Left {
	const namespace = node === undefined ? "" : literalText(node);
	if (namespace === undefined) {
		return {
			left: "its namespace is an expression: call the message by name, as m.<key>().",
		};
	}
	return { namespace, locale: undefined };
}

/** `getTranslations(ns)`, or `getTranslations({ locale, namespace })`. */
function serverScope(
	call: ESTree.CallExpression,
	module: ModuleView,
): Scope | Left {
	const [argument] = call.arguments;
	if (argument?.type !== "ObjectExpression") return namespaceScope(argument);
	const properties = propertiesOf(argument);
	if (properties === undefined) {
		return {
			left: "getTranslations' options are not an object written in the call, so its scope is unknown.",
		};
	}
	const scope = namespaceScope(properties.get("namespace")?.value);
	const locale = properties.get("locale")?.value;
	if ("left" in scope || locale === undefined) return scope;
	// getTranslations reads its locale once, and each call it becomes reads it again.
	if (!readsTheSame(locale, module.scopes)) return movedLocale;
	return { ...scope, locale };
}

/** A call of `t(key, values)`: the key under the namespace names the message; the values are its inputs. */
function nextIntlCall(
	call: ESTree.CallExpression,
	{ namespace, locale }: Scope,
	module: ModuleView,
): Outcome {
	const [keyNode, values, formats] = call.arguments;
	const key = literalText(keyNode);
	if (key === undefined) {
		return {
			left: "its key is an expression: call the message by name, as m.<key>().",
		};
	}
	if (formats !== undefined) {
		return {
			left: "it passes formats, which grai migrate does not read: give the message its formatting options instead.",
		};
	}
	const path = namespace === "" ? key : `${namespace}.${key}`;
	const mapped = module.mapping.keys.get(path);
	if (mapped === undefined) {
		return {
			left: `grai.import.json has no key ${path}: the import left it out, or no catalog has it.`,
		};
	}
	const passed = writtenProperties(values, "values");
	if ("left" in passed) return passed;
	const { object, properties: inputs } = passed;
	return messageCall(call, mapped, { inputs, object, locale }, module);
}
