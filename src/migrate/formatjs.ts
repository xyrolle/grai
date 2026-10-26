import type { ESTree } from "../code/parse.ts";
import type { Binding, Use } from "../code/scopes.ts";
import {
	literalText,
	type Node,
	propertiesOf,
	type Span,
} from "../code/syntax.ts";
import {
	boundProperty,
	calledAt,
	declaratorOf,
	droppedValue,
	type Left,
	type LibraryModule,
	type ModuleView,
	memberAt,
	type Outcome,
	ownApi,
	passedOn,
	readsTheSame,
	type Translator,
	type WrittenProperties,
	writtenProperties,
} from "./library.ts";
import { messageCall } from "./message-call.ts";

/** What a descriptor holds: the id names the message; the others are for translators and extraction. */
const descriptorFields = new Set(["id", "defaultMessage", "description"]);

const notWritten = {
	left: "its descriptor is not an object written in the call: write { id } in the call, or call the message by name.",
};
const expressionId = {
	left: "its id is an expression: call the message by name, as m.<key>().",
};
const noId = {
	left: "its descriptor has no id: give it the id its catalog has.",
};

/** react-intl's `useIntl` and `<FormattedMessage>`; FormatJS's own `createIntl` is left to a person. */
export const formatjsModules: Readonly<Record<string, LibraryModule>> = {
	"react-intl": {
		library: "react-intl",
		roles: {
			useIntl: { kind: "hook", translators: useIntl },
			FormattedMessage: { kind: "component", element: formattedMessage },
		},
	},
	"@formatjs/intl": { library: "@formatjs/intl", roles: {} },
};

/** `const intl = useIntl()`, whose `intl.formatMessage` calls messages, or `const { formatMessage } = useIntl()`. */
function useIntl(use: Use, module: ModuleView): Translator[] | Left {
	const call = calledAt(use, module.scopes);
	const declarator = call && declaratorOf(call, module.scopes);
	if (call === undefined || declarator === undefined) {
		return {
			left: "useIntl's result is not given a name here, so where it is called cannot be followed.",
		};
	}
	const pattern = declarator.id;
	if (pattern.type === "Identifier") {
		const binding = module.scopes.bindingOf(pattern);
		return binding === undefined
			? []
			: [intlObject(binding, declarator, module)];
	}
	const name = boundProperty(pattern, "formatMessage");
	const binding = name && module.scopes.bindingOf(name);
	if (binding === undefined) return [];
	return [
		{
			binding,
			declarator,
			translate(use) {
				const called = calledAt(use, module.scopes);
				return called ? formatMessageCall(called, module) : passedOn(use);
			},
		},
	];
}

/** The object `useIntl()` gives: its `formatMessage` calls messages; its other members are react-intl's own. */
function intlObject(
	binding: Binding,
	declarator: ESTree.VariableDeclarator,
	module: ModuleView,
): Translator {
	return {
		binding,
		declarator,
		translate(use) {
			const member = memberAt(use, module.scopes);
			if (member === undefined) return passedOn(use);
			const call = calledAt(member.node, module.scopes);
			if (member.name !== "formatMessage" || call === undefined) {
				return ownApi(`${use.name}.${member.name}`, "react-intl");
			}
			return formatMessageCall(call, module);
		},
	};
}

/** A call of `formatMessage({ id }, values)`: the id names the message; the values are its inputs. */
function formatMessageCall(
	call: ESTree.CallExpression,
	module: ModuleView,
): Outcome {
	const [descriptor, values] = call.arguments;
	const id = descriptorId(descriptor, module);
	if (typeof id !== "string") return id;
	return messageOf(call, id, writtenProperties(values, "values"), module);
}

/** The id a descriptor written in the call gives, or why there is none. */
function descriptorId(
	node: Node | undefined,
	module: ModuleView,
): string | Left {
	const properties =
		node?.type === "ObjectExpression" ? propertiesOf(node) : undefined;
	if (properties === undefined) return notWritten;
	for (const [name, { value }] of properties) {
		if (!descriptorFields.has(name)) {
			return {
				left: `its descriptor holds ${name}, which grai migrate does not read.`,
			};
		}
		const dropped = droppedField(name, value, module);
		if (dropped !== undefined) return dropped;
	}
	return idOf(properties.get("id")?.value);
}

/** Why a field a rewrite drops stays: its value is an expression that would no longer run. */
function droppedField(
	name: string,
	value: Node,
	{ scopes }: ModuleView,
): Left | undefined {
	const dropped = name === "defaultMessage" || name === "description";
	return dropped && !readsTheSame(value, scopes)
		? droppedValue(name)
		: undefined;
}

function idOf(node: Node | undefined): string | Left {
	if (node === undefined) return noId;
	return literalText(node) ?? expressionId;
}

/**
 * `<FormattedMessage id values />`, which renders the message's text: in JSX, the call between
 * braces; elsewhere, the call itself.
 */
function formattedMessage(
	element: ESTree.JSXElement,
	module: ModuleView,
): Outcome {
	const rendersChildren = element.children.some(
		(child) => child.type !== "JSXText" || child.value.trim() !== "",
	);
	if (rendersChildren) {
		return {
			left: "its children render the text: call the message by name there.",
		};
	}
	let id: string | Left = noId;
	let values: WrittenProperties | Left = writtenProperties(undefined, "values");
	for (const attribute of element.openingElement.attributes) {
		if (attribute.type === "JSXSpreadAttribute") return notWritten;
		const name =
			attribute.name.type === "JSXIdentifier" ? attribute.name.name : "";
		const value =
			attribute.value?.type === "JSXExpressionContainer"
				? attribute.value.expression
				: (attribute.value ?? undefined);
		if (name === "id") {
			id = value === undefined ? expressionId : idOf(value);
		} else if (name === "values") {
			values = writtenProperties(value, "values");
		} else if (!descriptorFields.has(name)) {
			return {
				left: `it passes FormattedMessage's ${name}, which grai migrate does not read.`,
			};
		} else if (value !== undefined) {
			const dropped = droppedField(name, value, module);
			if (dropped !== undefined) return dropped;
		}
	}
	if (typeof id !== "string") return id;
	const outcome = messageOf(element, id, values, module);
	if ("left" in outcome) return outcome;
	const parent = module.scopes.parent(element)?.type;
	const inJsx =
		parent === "JSXElement" ||
		parent === "JSXFragment" ||
		parent === "JSXAttribute";
	return inJsx ? { ...outcome, text: `{${outcome.text}}` } : outcome;
}

/** The message an id names, called with the values; or why it stays. */
function messageOf(
	replace: Span,
	id: string,
	values: WrittenProperties | Left,
	module: ModuleView,
): Outcome {
	const mapped = module.mapping.keys.get(id);
	if (mapped === undefined) {
		return {
			left: `grai.import.json has no key ${id}: the import left it out, or no catalog has it.`,
		};
	}
	if ("left" in values) return values;
	const { object, properties: inputs } = values;
	return messageCall(
		replace,
		mapped,
		{ inputs, object, locale: undefined },
		module,
	);
}
