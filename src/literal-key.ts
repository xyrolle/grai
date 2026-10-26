/**
 * A name as the key of an object literal the output writes: a string literal, computed for
 * `__proto__`, which an object literal would otherwise take as its prototype and not hold as a
 * property. A catalog key, a markup option or an attribute can be named so.
 */
export function literalKey(name: string): string {
	return name === "__proto__"
		? `[${JSON.stringify(name)}]`
		: JSON.stringify(name);
}

/** A key, an identifier, as the key of an object literal the output writes: computed for `__proto__`. */
export function identifierKey(key: string): string {
	return key === "__proto__" ? literalKey(key) : key;
}
