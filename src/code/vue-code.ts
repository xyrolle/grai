/**
 * A Vue single-file component's code, read through Vue's own parser: its `<script>` and
 * `<script setup>` as they are, then its template's expressions, each where Vue found it, in code
 * that opens the scopes the template opens. A `v-for`'s alias, key and index, and a `v-slot`'s
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
/** A part of the template Vue parsed as an expression, with its place in the component. */
type Expression = {
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
		if (node.exp === undefined) {
			if (node.name === "bind" && node.arg !== undefined) this.sameName(node);
			return;
		}
		// A handler that is a function is called with the event; any other runs as statements.
		const { start, end } = spanOf(node.exp);
		const handler = this.writer.source.slice(start, end).trimStart();
		if (node.name !== "on" || /^(?:async\s+)?function\b/.test(handler)) {
			this.expression(node.exp);
		} else {
			this.writer.write("(($event) => {\n").piece(start, end).write("\n});\n");
		}
	}

	/** `:name` without a value, which binds the value of the same name, if it is a name. */
	private sameName(node: Directive): void {
		if (node.arg === undefined) return;
		const name = spanOf(node.arg);
		const written = this.writer.source.slice(name.start, name.end);
		if (!/^[A-Za-z_$][\w$]*$/.test(written)) return;
		const replaces = spanOf(node);
		const full = this.writer.source.slice(replaces.start, replaces.end);
		this.writer.shorthand(name.start, name.end, {
			replaces,
			before: `${full}="`,
			after: '"',
		});
	}

	/** A function of the names the patterns bind, around what follows until it is closed. */
	private open(patterns: readonly (Expression | undefined)[]): void {
		this.writer.write("((");
		patterns.forEach((pattern, index) => {
			if (index > 0) this.writer.write(",");
			if (pattern !== undefined) {
				const { start, end } = spanOf(pattern);
				this.writer.piece(start, end);
			}
		});
		this.writer.write("\n) => {\n");
	}

	private expression(node: Expression): void {
		const { start, end } = spanOf(node);
		this.writer.expression(start, end);
	}
}

function isStatic(node: object): boolean {
	return "isStatic" in node && node.isStatic === true;
}

function spanOf({ loc }: Expression): { start: number; end: number } {
	return { start: loc.start.offset, end: loc.end.offset };
}
