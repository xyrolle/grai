/**
 * A Vue single-file component's code, read through Vue's own parser: its `<script>` and
 * `<script setup>` as they are, then its template's expressions, each where Vue found it and as Vue
 * decoded its HTML entities (`&amp;&amp;` is `&&`), in code that opens the scopes the template opens. A `v-for`'s alias, key and index, and a `v-slot`'s
 * props, are parameters of a function around what they are visible in; a `v-on` handler's
 * statements run in a function of `$event`, as Vue compiles them.
 */

import type { SFCTemplateBlock } from "vue/compiler-sfc";
import { CodeWriter, type SourceCode } from "./source.ts";

/** Vue's parse of a single-file component. */
type VueParse = typeof import("vue/compiler-sfc").parse;

type Root = NonNullable<SFCTemplateBlock["ast"]>;
type Child = Root["children"][number];
type Element = Extract<Child, { tag: string }>;
type Prop = Element["props"][number];
type Directive = Extract<Prop, { exp?: unknown }>;
/** An expression node of Vue's template parse. */
type ExpressionNode = NonNullable<Directive["exp"]>;
/** A part of the template Vue parsed as an expression, its HTML entities decoded, with its place. */
type Expression = {
	content: string;
	loc: { start: { offset: number }; end: { offset: number } };
};

/** Vue's numbers for the kinds of template node this reads. */
const element = 1;
const interpolation = 5;
const directive = 7;
/** Vue's number for a component among an element's kinds. */
const component = 1;

/** A component's code; an error of Vue's parse is thrown as the parse's first. */
export function vueCode(text: string, parse: VueParse): SourceCode {
	const { descriptor, errors } = parse(text, { filename: "component.vue" });
	const [error] = errors;
	if (error !== undefined) throw error;
	const writer = new CodeWriter(text);
	const scripts = [descriptor.script, descriptor.scriptSetup].flatMap(
		(script) => (script === null ? [] : [script]),
	);
	for (const { loc } of scripts) {
		writer.piece(loc.start.offset, loc.end.offset).write("\n;\n");
	}
	const ast = descriptor.template?.ast;
	if (ast !== undefined) new Template(writer).children(ast.children);
	const typescript = scripts.some(
		({ lang }) => lang === "ts" || lang === "tsx",
	);
	return writer.code(typescript ? "ts" : "js");
}

/** Writes a template's code. */
class Template {
	private readonly writer: CodeWriter;

	constructor(writer: CodeWriter) {
		this.writer = writer;
	}

	children(children: readonly Child[]): void {
		for (const child of children) {
			if (child.type === interpolation && "content" in child) {
				this.expression(child.content);
			} else if (child.type === element && "props" in child) {
				this.element(child);
			}
		}
	}

	/** An element: its `v-for` around the rest, its other directives, a component's name, its children. */
	private element(node: Element): void {
		const directives = node.props.filter(
			(prop): prop is Directive => prop.type === directive,
		);
		const loop = directives.find(({ name }) => name === "for");
		const result = loop?.forParseResult;
		if (result !== undefined) {
			this.expression(result.source);
			this.open([result.value, result.key, result.index]);
		}
		if (node.tagType === component && /^[A-Z]|\./.test(node.tag)) {
			const start = node.loc.start.offset + 1;
			this.writer.expression(start, start + node.tag.length);
		}
		for (const each of directives) {
			if (each !== loop && each.name !== "slot") this.directive(each);
		}
		const slot = directives.find(({ name }) => name === "slot");
		if (slot?.exp !== undefined) this.open([slot.exp]);
		else this.writer.write("{\n");
		this.children(node.children);
		this.writer.write(slot?.exp !== undefined ? "});\n" : "}\n");
		if (result !== undefined) this.writer.write("});\n");
	}

	private directive(node: Directive): void {
		if (node.arg !== undefined && !isStatic(node.arg))
			this.expression(node.arg);
		if (node.exp === undefined) return;
		// A handler that is a function is called with the event; any other runs as statements.
		const exp = expressionOf(node.exp);
		const { start, end } = spanOf(exp);
		const handler = exp.content.trimStart();
		if (node.name !== "on" || /^(?:async\s+)?function\b/.test(handler)) {
			this.writer.decodedExpression(start, end, exp.content);
		} else {
			this.writer
				.write("(($event) => {\n")
				.decoded(start, end, exp.content)
				.write("\n});\n");
		}
	}

	/** A function of the names the patterns bind, around what follows until it is closed. */
	private open(patterns: readonly (ExpressionNode | undefined)[]): void {
		this.writer.write("((");
		// `v-for`'s key and index are optional: the parameters are those it writes.
		patterns.forEach((pattern, index) => {
			if (pattern === undefined) return;
			if (index > 0) this.writer.write(",");
			const { content, ...placed } = expressionOf(pattern);
			const { start, end } = spanOf(placed);
			this.writer.decoded(start, end, content);
		});
		this.writer.write("\n) => {\n");
	}

	private expression(node: ExpressionNode): void {
		const { content, ...placed } = expressionOf(node);
		const { start, end } = spanOf(placed);
		this.writer.decodedExpression(start, end, content);
	}
}

function isStatic(node: object): boolean {
	return "isStatic" in node && node.isStatic === true;
}

/**
 * A template expression as Vue's parse gives every one: a simple expression, its text decoded.
 * Only Vue's transforms, which grai does not run, make a compound one.
 */
function expressionOf(node: ExpressionNode): Expression {
	if (!("content" in node)) {
		throw new TypeError("Vue's template parse gave a compound expression");
	}
	return node;
}

function spanOf({ loc }: Pick<Expression, "loc">): {
	start: number;
	end: number;
} {
	return { start: loc.start.offset, end: loc.end.offset };
}
