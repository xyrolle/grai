/**
 * The reads one use of an imported or loaded value makes: the names it reads in turn, followed
 * through the module graph, then what the code does with what they read, as `reads.ts` takes them.
 */

import type { Binding, Span, UseFact } from "./facts.ts";
import type { KeysHeld, ModuleGraph, Value } from "./modules.ts";
import type { SourceCode } from "./project.ts";
import type { Edit, Place, Reach, Read, Reading } from "./reads.ts";

/** The module being read, and where its reads go. */
export type Context = {
	path: string;
	source: SourceCode;
	graph: ModuleGraph;
	reading: Reading;
	/** The key a reading is for alone, if any: it leaves out the reads of other keys. */
	key: string | undefined;
};

/** What a promise hands its value on by. */
const promised: ReadonlySet<string> = new Set(["then", "catch", "finally"]);

/** The reads one use makes, following its names from what it starts from. */
export async function readUse(
	{ path, source, graph, reading, key }: Context,
	use: UseFact,
	origin: Value,
): Promise<void> {
	// A key an import binds is read where it is imported, its uses that binding's references.
	if (origin.kind === "key") return;
	// A name read off the namespace is that key's read and no other's.
	const first = use.chain[0];
	if (origin.kind === "namespace" && first !== undefined && key !== undefined) {
		if (first.name !== key) return;
	}
	const ownKey =
		origin.kind === "module" ? graph.output.keyOf(origin.path) : undefined;
	// A load's promise hands its module to a callback, `import(path).then((module) => …)`, which
	// is a use of the module whole; a key's own module is read where its path is.
	const handed = use.chain[0];
	if ("load" in use.from && handed !== undefined && promised.has(handed.name)) {
		const reached = reachOf(await graph.keysHeld(origin));
		if (ownKey === undefined && reached !== undefined) {
			const place = { path, source, at: handed.expression };
			reading.reaches.push(reachAt(place, reached, use.type));
		}
		return;
	}
	let value: Value | undefined = origin;
	let keyAt = use.at;
	let readAt = use.at;
	let name = "";
	let links = 0;
	for (const link of use.chain) {
		if (value.kind === "key") break;
		value = await graph.member(value, link.name);
		if (value === undefined) return;
		keyAt = link.at;
		readAt = link.expression;
		name = link.name;
		links++;
	}
	const via = ownKey === undefined ? "member" : "module";
	if (value.kind === "key") {
		reading.reads.push(
			read(
				{ path, source, at: keyAt },
				{
					key: value.key,
					via,
					edits: named(name, value.key, keyAt),
					binding: undefined,
					type: use.type,
					writtenAt: readAt,
					// Called only when the key's name is the last the use reads: `m.title()`.
					call:
						use.end.kind === "value" && links === use.chain.length
							? use.end.call
							: undefined,
				},
			),
		);
		return;
	}
	// The rest of a key's own module holds that key alone, which its path's read stands for.
	if (ownKey !== undefined && use.end.kind !== "pattern") return;
	const reach = async (at: Span, held: Value) => {
		if (ownKey !== undefined) return;
		const reached = reachOf(await graph.keysHeld(held));
		if (reached === undefined) return;
		reading.reaches.push(reachAt({ path, source, at }, reached, use.type));
	};
	const { end } = use;
	if (end.kind === "export") return;
	if (end.kind === "value") {
		await reach(readAt, value);
	} else if (end.kind === "computed") {
		const { at, prefix, choices } = end;
		if (value.kind === "namespace") {
			reading.reaches.push(
				reachAt({ path, source, at }, { prefix, choices }, use.type),
			);
		} else {
			await reach(at, value);
		}
	} else {
		for (const taken of end.names) {
			const held = await graph.member(value, taken.name);
			if (held === undefined) continue;
			if (held.kind !== "key") {
				await reach(taken.at, held);
				continue;
			}
			reading.reads.push(
				read(
					{ path, source, at: taken.at },
					{
						key: held.key,
						via: ownKey === undefined ? "pattern" : "module",
						edits: named(taken.name, held.key, taken.at),
						binding: taken.binds,
						type: use.type,
						written: text(source, taken.written),
					},
				),
			);
		}
		if (end.rest !== undefined) await reach(end.rest, value);
	}
}

/** The edit of a name a read writes, when it is the key's own; another name is not the key's. */
export function named(name: string, key: string, at: Span): Edit[] {
	return name === key ? [{ at, before: "", after: "" }] : [];
}

/** The reach of the keys a value holds, or none when it holds none. */
function reachOf(
	held: KeysHeld,
): { prefix: string; choices: string[] | undefined } | undefined {
	if (held === "every") return { prefix: "", choices: undefined };
	return held.size === 0 ? undefined : { prefix: "", choices: [...held] };
}

/** A read at a place, written as the place's text unless it says otherwise. */
export function read(
	place: Place,
	fields: {
		key: string;
		via: Read["via"];
		edits: Edit[];
		binding: Binding | undefined;
		type: boolean;
		/** The text the read is written as: this, or the text at `writtenAt`, or else at its place. */
		written?: string;
		writtenAt?: Span;
		call?: Span | undefined;
	},
): Read {
	const { written, writtenAt = place.at, call, ...rest } = fields;
	if (written !== undefined) return { ...place, ...rest, written, call };
	// The text it reads by, taken from the file only when a report asks for it.
	return {
		...place,
		...rest,
		call,
		get written() {
			return text(place.source, writtenAt);
		},
	};
}

export function reachAt(
	place: Place,
	{ prefix, choices }: { prefix: string; choices: string[] | undefined },
	type: boolean,
): Reach {
	return {
		...place,
		prefix,
		choices,
		type,
		get written() {
			return text(place.source, place.at);
		},
	};
}

function text({ text: file }: SourceCode, at: Span): string {
	return file.slice(at.start, at.end);
}
