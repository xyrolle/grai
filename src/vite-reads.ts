/**
 * The build's reads of grai's messages, at grai's transform before any other: each module's code as
 * the bundler holds it then, a component's before it compiles, read as `grai check` reads a file,
 * its imports followed by the bundler's resolution (`code/build-reading.ts`). A read of a key no
 * catalog has fails the build at its place, as check reports it; the client build's chunking takes
 * the keys each module reads or may reach.
 *
 * A build and check read the same code but in two cases, both from what only the bundler has: a
 * virtual module's code, which check cannot see, and code an earlier plugin added, which check reads
 * only if that plugin's output is a file.
 */

import { extname } from "node:path";
import type { Plugin } from "vite";
import type { BuildReading } from "./code/build-reading.ts";
import type { Reading } from "./code/reads.ts";
import { keysMissing, readErrors } from "./code-problems.ts";
import type { Build } from "./compile.ts";
import { messagesOf } from "./error.ts";
import { sourceExtensions } from "./sources.ts";

/** What the reads take from grai's plugin: its build, its reading in an environment, and a sink. */
export type BuildReads = {
	build: () => Build | undefined;
	/** The output's directory, whose modules are grai's and read no message. */
	outdir: () => string;
	reading: (environment: string) => BuildReading | undefined;
	read: (environment: string, id: string, reading: Reading) => void;
};

/** The plugin that reads each module of a build before any other plugin transforms it. */
export function buildReads(core: BuildReads): Plugin {
	return {
		name: "grai:reads",
		enforce: "pre",
		transform: {
			order: "pre",
			filter: { id: { exclude: [/\/node_modules\//, /\?/] } },
			async handler(code, id) {
				const build = core.build();
				const reading = core.reading(this.environment.name);
				if (build === undefined || reading === undefined) return null;
				if (id.startsWith(core.outdir()) || !sourceExtensions.has(extname(id)))
					return null;
				const read = await reading.reading(id, code);
				const errors = [
					...readErrors(read),
					...keysMissing(read, build.compilation.keys, build.config),
				];
				if (errors.length > 0) this.error(messagesOf(errors));
				core.read(this.environment.name, id, read);
				return null;
			},
		},
	};
}

/**
 * The keys a module reads or may reach at run time, for the chunking, and whether it may reach every
 * key. A read in a type reads nothing at run time.
 */
export function chunkReads(
	reading: Reading,
	keys: Iterable<string>,
): { keys: Set<string>; every: boolean } {
	const read = new Set<string>();
	let every = false;
	for (const { key, type } of reading.reads) if (!type) read.add(key);
	for (const { prefix, choices, type } of reading.reaches) {
		if (type) continue;
		if (choices !== undefined) {
			for (const key of choices) read.add(key);
		} else if (prefix === "") {
			every = true;
		} else {
			for (const key of keys) if (key.startsWith(prefix)) read.add(key);
		}
	}
	return { keys: read, every };
}
