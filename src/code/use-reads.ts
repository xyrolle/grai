/**
 * The reads one use of an imported or loaded value makes: the names it reads in turn, followed
 * through the module graph, then what the code does with what they read, as `reads.ts` takes them.
 */

import type { Binding, Span, UseFact } from "./facts.ts";
import type { KeysHeld, ModuleGraph, Value } from "./modules.ts";
import type { SourceCode } from "./project.ts";
import type { Place, Reach, Read, Reading } from "./reads.ts";

/** The module being read, and where its reads go. */
export type Context = {
	path: string;
	source: SourceCode;
	graph: ModuleGraph;
	reading: Reading;
};

/** What a promise hands its value on by. */
const promised: ReadonlySet<string> = new Set(["then", "catch", "finally"]);

/** The reads one use makes, following its names from what it starts from. */
export async function readUse(
	{ path, source, graph, reading }: Context,
	use: UseFact,
	origin: Value,
): Promise<void> {
	// A key an import binds is read where it is imported, its uses that binding's references; a
	// key's own module is read where its path is.
	if (origin.kind === "key") return;
	if (origin.kind === "module" && graph.output.keyOf(origin.path) !== undefined)
		return;
	// A load's promise hands its module to a callback, `import(path).then((module) => …)`, which
	// is a use of the module whole.
	const handed = use.chain[0];
	if ("load" in use.from && handed !== undefined && promised.has(handed.name)) {
		const reached = reachOf(await graph.keysHeld(origin));
		if (reached !== undefined) {
			const place = { path, source, at: handed.expression };
			reading.reaches.push(reachAt(place, reached, use.type));
		}
		return;
	}
	let value: Value | undefined = origin;
	let keyAt = use.at;
	let readAt = use.at;
	let via: Read["via"] = "binding";
	for (const link of use.chain) {
		if (value.kind === "key") break;
		value = await graph.member(value, link.name);
		if (value === undefined) return;
		keyAt = link.at;
		readAt = link.expression;
		via = "member";
	}
	const written = text(source, readAt);
	if (value.kind === "key") {
		const place = { path, source, at: keyAt };
		reading.reads.push(
			read(place, value.key, via, undefined, use.type, written),
		);
		return;
	}
	const reach = async (at: Span, held: Value) => {
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
		for (const name of end.names) {
			const taken = await graph.member(value, name.name);
			if (taken === undefined) continue;
			if (taken.kind === "key") {
				const place = { path, source, at: name.at };
				reading.reads.push(
					read(place, taken.key, "pattern", name.binds, use.type),
				);
			} else {
				await reach(name.at, taken);
			}
		}
		if (end.rest !== undefined) await reach(end.rest, value);
	}
}

/** The reach of the keys a value holds, or none when it holds none. */
function reachOf(
	held: KeysHeld,
): { prefix: string; choices: string[] | undefined } | undefined {
	if (held === "every") return { prefix: "", choices: undefined };
	return held.size === 0 ? undefined : { prefix: "", choices: [...held] };
}

export function read(
	place: Place,
	key: string,
	via: Read["via"],
	binding: Binding | undefined,
	type: boolean,
	written: string = text(place.source, place.at),
): Read {
	return { ...place, key, written, type, via, binding };
}

export function reachAt(
	place: Place,
	{ prefix, choices }: { prefix: string; choices: string[] | undefined },
	type: boolean,
): Reach {
	const written = text(place.source, place.at);
	return { ...place, written, prefix, choices, type };
}

function text({ text: file }: SourceCode, at: Span): string {
	return file.slice(at.start, at.end);
}
