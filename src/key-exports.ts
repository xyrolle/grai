/**
 * The exports of a module's keys, each its name and the value it exports. `taken` holds every
 * name the module's own code calls or binds besides its keys: its imports, such as `text`, and
 * any binding of its own, such as the dev module's `T`. A key binds its own name,
 * `export const key = value;`, unless that name is taken. Then the key binds a name of its own,
 * `$` and the key, with `$` again while that is bound too, exported under the key:
 * `const $text = value; export { $text as text };`. So no key can take the name of anything its
 * module calls, and a key that takes none costs nothing.
 */
export function keyExports(
	keys: readonly { readonly name: string; readonly value: string }[],
	taken: ReadonlySet<string>,
): string {
	/** The names bound so far, made only once a key takes one. */
	let bound: Set<string> | undefined;
	return keys
		.map(({ name, value }) => {
			if (!taken.has(name)) return `export const ${name} = ${value};\n`;
			bound ??= new Set([...taken, ...keys.map((key) => key.name)]);
			const own = freshName(`$${name}`, bound);
			bound.add(own);
			return `const ${own} = ${value};\nexport { ${own} as ${name} };\n`;
		})
		.join("");
}

/** `name`, or `$` before it, again while that is bound too: the first of them `bound` lacks. */
export function freshName(name: string, bound: ReadonlySet<string>): string {
	let fresh = name;
	while (bound.has(fresh)) fresh = `$${fresh}`;
	return fresh;
}
