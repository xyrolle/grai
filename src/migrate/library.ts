import type { ESTree } from "vite";
import type { Mapping } from "../import/mapping.ts";
import type { Binding, Scopes, Use } from "./scopes.ts";
import { literalText, type Node, propertiesOf, type Span } from "./syntax.ts";

/** Why a use stays as it is, for the person who migrates it. */
export type Left = { left: string };

/** What a use becomes: the message call that replaces a span, or why it stays as it is. */
export type Outcome = { replace: Span; text: string } | Left;

/** A module as a library's rules read it: its text, its names, and the import's mapping. */
export type ModuleView = {
	text: string;
	scopes: Scopes;
	mapping: Mapping;
	/** The namespace an i18next call names when it names none: i18next's `defaultNS`. */
	defaultNamespace: string;
};

/** A name that calls messages, the declarator that binds it, and what each of its uses becomes. */
export type Translator = {
	binding: Binding;
	/** Where the name is declared, cut once every use is rewritten; none for an import's own name. */
	declarator?: ESTree.VariableDeclarator;
	translate(use: Use): Outcome;
};

/** What a name a library's module exports is to grai migrate. */
export type Role =
	/** It calls messages itself, as i18next's `t` does. */
	| {
			kind: "translator";
			translator(binding: Binding, module: ModuleView): Translator;
	  }
	/** Its call gives names that call messages, as `useTranslation()` does, or says why not. */
	| {
			kind: "hook";
			translators(use: Use, module: ModuleView): Translator[] | Left;
	  }
	/** A component that renders a message, as `<FormattedMessage>` does. */
	| {
			kind: "component";
			element(element: ESTree.JSXElement, module: ModuleView): Outcome;
	  };

/** A library's module: the library a report names, and the roles of the names it exports; any other is the library's own. */
export type LibraryModule = {
	library: string;
	roles: Readonly<Record<string, Role>>;
};

/** Why a use stays: the name is handed to code grai migrate cannot follow. */
export function passedOn(use: Use): Left {
	return {
		left: `${use.name} is passed on, so where it is called cannot be followed: call the messages by name there.`,
	};
}

/** Why a use stays: it is the library's own API, which a person replaces. */
export function ownApi(name: string, library: string): Left {
	return {
		left: `${name} is ${library}'s own: replace it by hand, with grai's runtime where it has a counterpart.`,
	};
}

/**
 * Whether an expression reads the same whenever a rewrite evaluates it, or evaluates it no more: a
 * string, or a name the module declares that nothing assigns again. A rewrite that copies the name
 * into a call checks that it names the same declaration there (`messageCall`).
 */
export function readsTheSame(node: Node, scopes: Scopes): boolean {
	if (literalText(node) !== undefined) return true;
	if (node.type !== "Identifier") return false;
	const binding = scopes.resolve(node.name, node.start);
	return binding !== undefined && !scopes.isAssignedAgain(binding);
}

/** Why a call stays: the rewrite would move its locale where it may read otherwise. */
export const movedLocale = {
	left: "its locale is an expression grai migrate cannot prove reads the same where the rewrite puts it: write it as a string, or as a name nothing assigns again.",
};

/** Why a call stays: the rewrite would drop a value of its, which then no longer runs. */
export function droppedValue(name: string): Left {
	return {
		left: `its ${name} is an expression the rewrite would no longer evaluate: write it as a string, or remove it.`,
	};
}

/** The call a node is the callee of, if it is one. */
export function calledAt(
	node: Node,
	scopes: Scopes,
): ESTree.CallExpression | undefined {
	const parent = scopes.parent(node);
	return parent?.type === "CallExpression" && parent.callee === node
		? parent
		: undefined;
}

/** The member a use reads, `use.member`, and the node that reads it. */
export function memberAt(
	use: Use,
	scopes: Scopes,
): { name: string; node: ESTree.MemberExpression } | undefined {
	const parent = scopes.parent(use);
	if (parent?.type !== "MemberExpression" || parent.object !== use) {
		return undefined;
	}
	if (parent.computed || parent.property.type !== "Identifier")
		return undefined;
	return { name: parent.property.name, node: parent };
}

/** The declarator a call initializes, awaited or not, as `const t = await getTranslations()` is. */
export function declaratorOf(
	call: ESTree.CallExpression,
	scopes: Scopes,
): ESTree.VariableDeclarator | undefined {
	const parent = scopes.parent(call);
	const awaited = parent?.type === "AwaitExpression";
	const value = awaited ? parent : call;
	const holder = awaited ? scopes.parent(parent) : parent;
	return holder?.type === "VariableDeclarator" && holder.init === value
		? holder
		: undefined;
}

/** The identifier a pattern binds to an object's property, `{ name }` or `{ name: local }`. */
export function boundProperty(
	pattern: ESTree.BindingPattern,
	name: string,
): Node | undefined {
	if (pattern.type !== "ObjectPattern") return undefined;
	for (const property of pattern.properties) {
		const named =
			property.type === "Property" &&
			!property.computed &&
			property.key.type === "Identifier" &&
			property.key.name === name;
		if (named && property.value.type === "Identifier") return property.value;
	}
	return undefined;
}

/** An object a call writes, and its properties by name. */
export type WrittenProperties = {
	object: ESTree.ObjectExpression | undefined;
	properties: Map<string, ESTree.ObjectProperty>;
};

/**
 * The properties of an object a call passes as values or options, written in the call: none when
 * it passes none; why not when it is another expression, or spreads or computes a property.
 */
export function writtenProperties(
	node: Node | undefined,
	noun: string,
): WrittenProperties | Left {
	if (node === undefined) return { object: undefined, properties: new Map() };
	const properties =
		node.type === "ObjectExpression" ? propertiesOf(node) : undefined;
	if (node.type !== "ObjectExpression" || properties === undefined) {
		return {
			left: `its ${noun} are not an object written in the call, so what they pass is unknown.`,
		};
	}
	return { object: node, properties };
}
