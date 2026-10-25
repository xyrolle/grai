/**
 * A table of grai's looked up by a name from a catalog, a source file or the command line. The
 * table is an object, so `table[name]` also finds what every object inherits, such as
 * `constructor` or `toString`, which is no entry of it.
 */

/** The entry a table has of its own under a name, or undefined. */
export function ownEntry<T>(
	table: Readonly<Record<string, T>>,
	name: string,
): T | undefined {
	return Object.hasOwn(table, name) ? table[name] : undefined;
}
