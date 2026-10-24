// Text inlined into a Svelte component's template for one locale, before Svelte compiles it, for
// inline-build.mjs. A call `{m.key()}` of a message without inputs becomes the message's text,
// so Svelte sees static text: template text in a text position, a static value as an attribute or
// prop. A call with arguments, a message with inputs or markup, and a scope that binds the
// imported name to something else keep the call.
import { parse } from "svelte/compiler";
import { escapeAttribute, templateText } from "./svelte-text.mjs";

/** The fields of a template node that hold a fragment of its children. */
const FRAGMENTS = [
	"fragment",
	"consequent",
	"alternate",
	"body",
	"fallback",
	"pending",
	"then",
	"catch",
];

/** The local names the component's imports give `m`, the messages. */
function messageNames(ast) {
	const names = new Set();
	for (const script of [ast.module, ast.instance]) {
		for (const statement of script?.content.body ?? []) {
			if (statement.type !== "ImportDeclaration") continue;
			for (const specifier of statement.specifiers)
				if (
					specifier.type === "ImportSpecifier" &&
					specifier.imported.name === "m"
				)
					names.add(specifier.local.name);
		}
	}
	return names;
}

/** Every name a destructuring pattern binds. */
function patternNames(pattern) {
	if (!pattern) return [];
	switch (pattern.type) {
		case "Identifier":
			return [pattern.name];
		case "ObjectPattern":
			return pattern.properties.flatMap((property) =>
				patternNames(
					property.type === "RestElement" ? property : property.value,
				),
			);
		case "ArrayPattern":
			return pattern.elements.flatMap(patternNames);
		case "RestElement":
			return patternNames(pattern.argument);
		case "AssignmentPattern":
			return patternNames(pattern.left);
		default:
			return [];
	}
}

/** The names a block binds for its children: an each block's item and index, and the like. */
function boundBy(node) {
	switch (node.type) {
		case "EachBlock":
			return [...patternNames(node.context), node.index].filter(Boolean);
		case "AwaitBlock":
			return [...patternNames(node.value), ...patternNames(node.error)];
		case "SnippetBlock":
			return node.parameters.flatMap(patternNames);
		default:
			return [];
	}
}

/** The names `{@const}` tags declare in a fragment, for the whole fragment. */
const constNames = (fragment) =>
	fragment.nodes.flatMap((node) =>
		node.type === "ConstTag"
			? node.declaration.declarations.flatMap((declaration) =>
					patternNames(declaration.id),
				)
			: [],
	);

const without = (names, bound) =>
	bound.some((name) => names.has(name))
		? new Set([...names].filter((name) => !bound.includes(name)))
		: names;

/** The key `expression` calls with no arguments on one of `names`, as `m.key()`. */
function calledKey(expression, names) {
	if (
		expression.type !== "CallExpression" ||
		expression.optional ||
		expression.arguments.length > 0
	)
		return undefined;
	const { callee } = expression;
	return callee.type === "MemberExpression" &&
		!callee.computed &&
		!callee.optional &&
		callee.object.type === "Identifier" &&
		names.has(callee.object.name)
		? callee.property.name
		: undefined;
}

/**
 * The component's source with each call of a message in `texts` (key → its text in the locale)
 * replaced by the text, and the count of sites inlined by place, or undefined when there is none.
 */
export function inlineTemplate(source, texts, filename) {
	const ast = parse(source, { modern: true, filename });
	const edits = [];
	const sites = { text: 0, attribute: 0 };

	const inline = (tag, names, place, written) => {
		const text = texts.get(calledKey(tag.expression, names));
		if (text === undefined) return;
		edits.push({ start: tag.start, end: tag.end, text: written(text) });
		sites[place]++;
	};
	const visitAttribute = (attribute, names) => {
		if (attribute.value === true) return;
		if (!Array.isArray(attribute.value))
			return inline(
				attribute.value,
				names,
				"attribute",
				(text) => `"${escapeAttribute(text)}"`,
			);
		for (const part of attribute.value)
			if (part.type === "ExpressionTag")
				inline(part, names, "attribute", escapeAttribute);
	};
	const visitNode = (node, names) => {
		if (node.type === "ExpressionTag")
			return inline(node, names, "text", templateText);
		for (const attribute of node.attributes ?? [])
			if (attribute.type === "Attribute") visitAttribute(attribute, names);
		const inner = without(names, boundBy(node));
		for (const field of FRAGMENTS)
			if (node[field]?.type === "Fragment") visitFragment(node[field], inner);
	};
	const visitFragment = (fragment, names) => {
		const inner = without(names, constNames(fragment));
		if (inner.size === 0) return;
		for (const node of fragment.nodes) visitNode(node, inner);
	};

	visitFragment(ast.fragment, messageNames(ast));
	if (edits.length === 0) return undefined;
	let code = source;
	for (const edit of edits.sort((a, b) => b.start - a.start))
		code = code.slice(0, edit.start) + edit.text + code.slice(edit.end);
	return { code, sites };
}
