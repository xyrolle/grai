/**
 * A Svelte component's code, read through Svelte's own parser: its scripts as they are, then its
 * template's expressions, each where Svelte found it, in code that opens the scopes the template
 * opens. An `{#each}` item, an `{:then}` value, a snippet's parameters and a `let:` directive's
 * names are parameters of a function around what they are visible in, `{@const}` a `const` in the
 * block it is in, and a snippet a function of the component, as Svelte scopes them.
 */

import type { AST } from "svelte/compiler";
import { CodeWriter, type SourceCode } from "./source.ts";

/** A component's code, from Svelte's parse of it (`frameworks.ts`) and its text. */
export function svelteCode(text: string, root: AST.Root): SourceCode {
	const writer = new CodeWriter(text);
	const scripts: AST.Script[] = [];
	for (const script of [root.module, root.instance]) {
		if (script) scripts.push(script);
	}
	for (const { content } of scripts) {
		const { start, end } = spanOf(content);
		writer.piece(start, end).write("\n;\n");
	}
	new Template(writer).fragment(root.fragment);
	const typescript = scripts.some(({ attributes }) =>
		attributes.some(({ name, value }) => name === "lang" && isTs(value)),
	);
	return writer.code(typescript ? "ts" : "js");
}

function isTs(value: AST.Attribute["value"]): boolean {
	const [text] = Array.isArray(value) ? value : [];
	return text?.type === "Text" && text.data === "ts";
}

/** Writes a template's code. */
class Template {
	private readonly writer: CodeWriter;

	constructor(writer: CodeWriter) {
		this.writer = writer;
	}

	fragment({ nodes }: AST.Fragment): void {
		for (const node of nodes) this.node(node);
	}

	private node(node: AST.Fragment["nodes"][number]): void {
		switch (node.type) {
			case "Text":
			case "Comment":
				break;
			case "ExpressionTag":
			case "HtmlTag":
			case "RenderTag":
			case "AttachTag":
				this.expression(node.expression);
				break;
			case "DebugTag":
				for (const identifier of node.identifiers) this.expression(identifier);
				break;
			case "ConstTag":
			case "DeclarationTag": {
				const { start, end } = spanOf(node.declaration);
				this.writer.piece(start, end).write("\n;\n");
				break;
			}
			case "IfBlock":
				this.expression(node.test);
				this.block(node.consequent);
				if (node.alternate !== null) this.block(node.alternate);
				break;
			case "EachBlock":
				this.each(node);
				break;
			case "AwaitBlock":
				this.expression(node.expression);
				if (node.pending !== null) this.block(node.pending);
				if (node.then !== null) this.scoped([node.value], node.then);
				if (node.catch !== null) this.scoped([node.error], node.catch);
				break;
			case "KeyBlock":
				this.expression(node.expression);
				this.block(node.fragment);
				break;
			case "SnippetBlock":
				this.snippet(node);
				break;
			default:
				this.element(node);
		}
	}

	private each(node: AST.EachBlock): void {
		this.expression(node.expression);
		this.writer.write("((");
		// A block that names no item, `{#each list, index}`, binds its index alone: an empty pattern
		// holds the item's place and declares nothing.
		if (node.context === null) this.writer.write("[]");
		else this.pattern(node.context);
		if (node.index !== undefined) this.writer.write(`, ${node.index}`);
		this.writer.write("\n) => {\n");
		if (node.key !== undefined) this.expression(node.key);
		this.fragment(node.body);
		this.writer.write("});\n");
		if (node.fallback !== undefined) this.block(node.fallback);
	}

	private snippet(node: AST.SnippetBlock): void {
		const { start, end } = spanOf(node.expression);
		this.writer.write("function ").piece(start, end).write("(");
		node.parameters.forEach((parameter, index) => {
			if (index > 0) this.writer.write(",");
			this.pattern(parameter);
		});
		this.writer.write("\n) {\n");
		this.fragment(node.body);
		this.writer.write("}\n");
	}

	/** An element or a component: its name, if it names a binding, its attributes, its children. */
	private element(node: AST.ElementLike): void {
		if (node.type === "Component") {
			const start = node.start + 1;
			this.writer.expression(start, start + node.name.length);
		}
		if (node.type === "SvelteComponent") this.expression(node.expression);
		if (node.type === "SvelteElement") this.expression(node.tag);
		const lets: AST.LetDirective[] = [];
		for (const attribute of node.attributes) {
			if (attribute.type === "LetDirective") lets.push(attribute);
			else this.attribute(attribute);
		}
		if (lets.length === 0) {
			this.block(node.fragment);
			return;
		}
		this.writer.write("((");
		lets.forEach((directive, index) => {
			if (index > 0) this.writer.write(",");
			if (directive.expression === null) this.writer.write(directive.name);
			else this.pattern(directive.expression);
		});
		this.writer.write("\n) => {\n");
		this.fragment(node.fragment);
		this.writer.write("});\n");
	}

	private attribute(
		attribute: Exclude<AST.ElementLike["attributes"][number], AST.LetDirective>,
	): void {
		if (attribute.type === "Attribute" || attribute.type === "StyleDirective") {
			const { value } = attribute;
			if (value === true) return;
			for (const part of Array.isArray(value) ? value : [value]) {
				if (part.type === "ExpressionTag") this.expression(part.expression);
			}
			return;
		}
		if (attribute.expression !== null) this.expression(attribute.expression);
	}

	/** A fragment in a block of its own, where its `{@const}`s stay. */
	private block(fragment: AST.Fragment): void {
		this.writer.write("{\n");
		this.fragment(fragment);
		this.writer.write("}\n");
	}

	/** A fragment in a function of the names the patterns bind. */
	private scoped(patterns: readonly (object | null)[], fragment: AST.Fragment) {
		this.writer.write("((");
		patterns.forEach((pattern, index) => {
			if (index > 0) this.writer.write(",");
			if (pattern !== null) this.pattern(pattern);
		});
		this.writer.write("\n) => {\n");
		this.fragment(fragment);
		this.writer.write("});\n");
	}

	private expression(node: object): void {
		const { start, end } = spanOf(node);
		this.writer.expression(start, end);
	}

	private pattern(node: object): void {
		const { start, end } = spanOf(node);
		this.writer.piece(start, end);
	}
}

/** Where a node of Svelte's tree is in the component, which every node it parses carries. */
function spanOf(node: object): { start: number; end: number } {
	const start =
		"start" in node && typeof node.start === "number" ? node.start : 0;
	const end = "end" in node && typeof node.end === "number" ? node.end : start;
	return { start, end };
}
