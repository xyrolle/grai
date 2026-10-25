// Messages without inputs replaced by their strings at their call sites after Svelte compiled the
// component, as a bundler transform would replace them, for svelte-texts.mjs. By then Svelte has
// compiled each call as a dynamic expression, and the string stays inside it.
import { parseSync, Visitor } from "rolldown/utils";

const importedName = (specifier) =>
	specifier.imported.type === "Identifier"
		? specifier.imported.name
		: specifier.imported.value;

/** The compiled code with each argument-less call of a key in `strings` replaced by its literal. */
function replaceCalls(code, strings) {
	const { program } = parseSync("component.js", code);
	const keyOf = new Map();
	for (const statement of program.body) {
		if (statement.type !== "ImportDeclaration") continue;
		for (const specifier of statement.specifiers)
			if (
				specifier.type === "ImportSpecifier" &&
				strings.has(importedName(specifier))
			)
				keyOf.set(specifier.local.name, importedName(specifier));
	}
	const edits = [];
	new Visitor({
		CallExpression(call) {
			if (call.callee.type !== "Identifier" || call.arguments.length > 0)
				return;
			const key = keyOf.get(call.callee.name);
			if (key !== undefined)
				edits.push({
					start: call.start,
					end: call.end,
					text: strings.get(key),
				});
		},
	}).visit(program);
	let replaced = code;
	for (const edit of edits.sort((a, b) => b.start - a.start))
		replaced =
			replaced.slice(0, edit.start) + edit.text + replaced.slice(edit.end);
	return replaced;
}

/** Vite's plugin for it; `strings` holds each text key's string in one locale, as a literal. */
export const stringsAfterCompile = (strings) => ({
	name: "grai-bench-strings-after-compile",
	transform: {
		order: "post",
		filter: { id: /\.svelte$/ },
		handler: (code) => ({ code: replaceCalls(code, strings), map: null }),
	},
});
