// What share of an app's message call sites an inliner can replace with text. It reads every
// Svelte and script file under the app's src/ (tests and generated code left out) and sorts each
// use of `m.key` by where it stands: the whole of a template's text expression or of an attribute
// or prop (inlined as static text), part of a larger template expression (a literal, still dynamic), in
// script, used as a value without a call, or a dynamic key. Those last three keep the per-locale
// function. Reads only; it changes nothing.
//   node call-sites.mjs <app>
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseSync } from "rolldown/utils";
import { parse } from "svelte/compiler";
import { selectedApps } from "./apps.mjs";

const [app] = selectedApps(process.argv.slice(2, 3));
const counts = {
	template: 0,
	attribute: 0,
	expression: 0,
	script: 0,
	value: 0,
	dynamic: 0,
};

function* sourceFiles(directory) {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) {
			if (entry.name !== "paraglide" && entry.name !== "node_modules")
				yield* sourceFiles(path);
		} else if (
			/\.(svelte|ts|js)$/.test(entry.name) &&
			!/\.test\.|\.spec\./.test(entry.name)
		) {
			yield path;
		}
	}
}

const isMessages = (node) => node?.type === "Identifier" && node.name === "m";

/** Counts every `m.key` and `m[key]` under `node`; `whole` is the expression a text or attribute is made of. */
function visit(node, place, whole, parent) {
	if (!node || typeof node.type !== "string") return;
	if (node.type === "MemberExpression" && isMessages(node.object)) {
		const called = parent?.type === "CallExpression" && parent.callee === node;
		if (node.computed) counts.dynamic++;
		else if (!called) counts.value++;
		else if (place === "script") counts.script++;
		else if (parent === whole) counts[place]++;
		else counts.expression++;
		return;
	}
	for (const [field, value] of Object.entries(node)) {
		if (field === "parent" || field === "loc") continue;
		for (const child of Array.isArray(value) ? value : [value]) {
			if (child && typeof child === "object") visit(child, place, whole, node);
		}
	}
}

/** Walks a Svelte template, telling text expressions and attribute values from the rest. */
function visitTemplate(node, attribute) {
	if (!node || typeof node !== "object") return;
	if (Array.isArray(node)) {
		for (const child of node) visitTemplate(child, attribute);
		return;
	}
	if (node.type === "ExpressionTag") {
		visit(
			node.expression,
			attribute ? "attribute" : "template",
			node.expression,
			node,
		);
		return;
	}
	if (node.type === "Attribute") {
		visitTemplate(node.value, true);
		return;
	}
	for (const [field, value] of Object.entries(node)) {
		if (field === "parent" || field === "metadata") continue;
		if (
			value &&
			typeof value === "object" &&
			(Array.isArray(value) || typeof value.type === "string")
		) {
			if (
				value.type &&
				value.type !== "Fragment" &&
				!/Block|Element|Tag|Component|Attribute|Text|Fragment/.test(value.type)
			) {
				visit(value, "expression", undefined, node);
			} else {
				visitTemplate(value, attribute);
			}
		}
	}
}

for (const file of sourceFiles(join(app.root, "src"))) {
	const source = readFileSync(file, "utf8");
	if (!source.includes("m.") && !source.includes("m[")) continue;
	if (file.endsWith(".svelte")) {
		const ast = parse(source, { modern: true });
		for (const script of [ast.instance, ast.module])
			if (script) visit(script.content, "script");
		visitTemplate(ast.fragment, false);
	} else {
		visit(parseSync(file, source).program, "script");
	}
}

const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
const share = (count) => `${count} (${((100 * count) / total).toFixed(0)}%)`;
console.log(`\n### ${app.name}: ${total} message uses in src/\n`);
console.log("| where | uses |\n|---|---|");
console.log(
	`| the whole of a template text expression: inlined as static text | ${share(counts.template)} |`,
);
console.log(
	`| the whole of an attribute or prop value: inlined as a static value | ${share(counts.attribute)} |`,
);
console.log(
	`| part of a larger template expression: a literal, still dynamic | ${share(counts.expression)} |`,
);
console.log(`| in script | ${share(counts.script)} |`);
console.log(`| a value, not called | ${share(counts.value)} |`);
console.log(`| a dynamic key | ${share(counts.dynamic)} |`);
