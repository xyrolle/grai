/**
 * A Svelte component's code, read through Svelte's own parser: its scripts as they are, then its
 * template's expressions, each where Svelte found it, in code that opens the scopes the template
 * opens. Beside a module script, the instance script and the template are a block of their own, as
 * Svelte scopes them inside the module's: the instance's imports and re-exports go to the top, and
 * its own exports are its declarations, or reads of the names they export. An `{#each}` item, an
 * `{:then}` value, a snippet's parameters and a `let:` directive's names are parameters of a
 * function around what they are visible in, `{@const}` a `const` in the block it is in, and a
 * snippet a function of the component, as Svelte scopes them. Each such function is `async`, as
 * Svelte's async mode (`experimental.async`) lets any expression of the template `await`, in a
 * scope as at the top. Outside that mode Svelte's compiler refuses every `await` of a template, at
 * the top too, and its parse, which grai reads through, takes them all: the build then fails on
 * Svelte's own error, not on grai's read.
 */

import type { AST } from "svelte/compiler";
import { type ESTree, parse } from "./parse.ts";
import { CodeWriter, type Lang, type SourceCode } from "./source.ts";
import { spanOf, writeAttribute } from "./svelte-attributes.ts";

/** A component's code, from Svelte's parse of it (`frameworks.ts`) and its text. */
export function svelteCode(text: string, root: AST.Root): SourceCode {
	const writer = new CodeWriter(text);
	const scripts: AST.Script[] = [];
	for (const script of [root.module, root.instance]) {
		if (script) scripts.push(script);
	}
	const typescript = scripts.some(({ attributes }) =>
		attributes.some(({ name, value }) => name === "lang" && isTs(value)),
	);
	const lang: Lang = typescript ? "ts" : "js";
	const instance =
		root.module && root.instance
			? statementsOf(text, root.instance, lang)
			: undefined;
	if (root.module && instance) {
		const { start, end } = spanOf(root.module.content);
		writer.imports(start).piece(start, end).write("\n;\n");
		instanceInBlock(writer, instance, () =>
			new Template(writer).fragment(root.fragment),
		);
		return writer.code(lang);
	}
	for (const { content } of scripts) {
		const { start, end } = spanOf(content);
		writer.imports(start).piece(start, end).write("\n;\n");
	}
	new Template(writer).fragment(root.fragment);
	return writer.code(lang);
}

/** A script's top-level statements, at offsets in the script from `offset` in the component. */
type Statements = { body: readonly ESTree.Statement[]; offset: number };

/** A script's top-level statements, or none when it does not parse. */
function statementsOf(
	text: string,
	{ content }: AST.Script,
	lang: Lang,
): Statements | undefined {
	const { start, end } = spanOf(content);
	const { program, errors } = parse("instance", text.slice(start, end), {
		lang,
	});
	// A script that does not parse is read whole, so the component's read reports its error.
	return errors.length > 0 ? undefined : { body: program.body, offset: start };
}

/**
 * The instance script's statements and then the template in a block, its imports and re-exports
 * first at the top, as only the top may hold them. An export of its own is its declaration, or a
 * read of each name it exports, as the component's exports are no module's.
 */
function instanceInBlock(
	writer: CodeWriter,
	{ body, offset }: Statements,
	template: () => void,
): void {
	const statement = ({ start, end }: { start: number; end: number }) =>
		writer.piece(offset + start, offset + end).write("\n;\n");
	const top = (node: ESTree.Statement) =>
		node.type === "ImportDeclaration" ||
		node.type === "ExportAllDeclaration" ||
		(node.type === "ExportNamedDeclaration" && node.source !== null);
	for (const node of body.filter(top)) statement(node);
	writer.write("{\n");
	for (const node of body) {
		if (top(node)) continue;
		if (node.type !== "ExportNamedDeclaration") statement(node);
		else if (node.declaration !== null) statement(node.declaration);
		else {
			for (const { local } of node.specifiers) {
				writer.expression(offset + local.start, offset + local.end);
			}
		}
	}
	template();
	writer.write("}\n");
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
		this.writer.write("(async (");
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
		this.writer.write("async function ").piece(start, end).write("(");
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
			else writeAttribute(this.writer, attribute);
		}
		if (lets.length === 0) {
			this.block(node.fragment);
			return;
		}
		this.writer.write("(async (");
		lets.forEach((directive, index) => {
			if (index > 0) this.writer.write(",");
			if (directive.expression === null) this.writer.write(directive.name);
			else this.pattern(directive.expression);
		});
		this.writer.write("\n) => {\n");
		this.fragment(node.fragment);
		this.writer.write("});\n");
	}

	/** A fragment in a block of its own, where its `{@const}`s stay. */
	private block(fragment: AST.Fragment): void {
		this.writer.write("{\n");
		this.fragment(fragment);
		this.writer.write("}\n");
	}

	/** A fragment in a function of the names the patterns bind. */
	private scoped(patterns: readonly (object | null)[], fragment: AST.Fragment) {
		this.writer.write("(async (");
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
