/**
 * A build's reading of its modules, at grai's transform before any other: each module's code as the
 * bundler holds it then, read as the CLI reads a file, its imports resolved by the bundler. A module
 * an import is followed through is read once, from the code the build read for it, or else from its
 * file. A watching build reads its modules again from its next start.
 */

import { readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { keyOfModule } from "../output-paths.ts";
import { sourceExtensions } from "../sources.ts";
import { type FileFacts, factsOf } from "./facts.ts";
import { ModuleGraph, type Resolve } from "./modules.ts";
import { noReads, type Reading, readSource } from "./reads.ts";

export class BuildReading {
	private readonly root: string;
	private readonly graph: ModuleGraph;
	private readonly facts = new Map<string, Promise<FileFacts | undefined>>();
	private readonly read = new Map<
		string,
		{ code: string; reading: Promise<Reading> }
	>();

	/** A build's reading, of a project at `root` whose output is in `outdir`. */
	constructor(root: string, outdir: string, resolve: Resolve) {
		this.root = root;
		const output = {
			messages: join(outdir, "messages.js"),
			keys: join(outdir, "keys.js"),
			keyOf: keyOfModule,
		};
		this.graph = new ModuleGraph(output, resolve, (path) => this.ofFile(path));
	}

	/** A module's reads, from its code; a module's same code is read once. */
	reading(id: string, code: string): Promise<Reading> {
		const known = this.read.get(id);
		if (known?.code === code) return known.reading;
		const reading = this.readModule(id, code);
		this.read.set(id, { code, reading });
		return reading;
	}

	private async readModule(id: string, code: string): Promise<Reading> {
		const facts = factsOf(id, code);
		this.facts.set(id, facts);
		const reading = noReads();
		const source = {
			file: relative(this.root, id),
			text: code,
			facts: await facts,
		};
		await readSource(id, source, this.graph, reading);
		return reading;
	}

	/** A module's facts, from the code the build read for it, or else from its file. */
	private ofFile(path: string): Promise<FileFacts | undefined> {
		const known = this.facts.get(path);
		if (known !== undefined) return known;
		// A module that is no file, or no code grai reads, holds none of grai's names.
		const facts = sourceExtensions.has(extname(path))
			? readFile(path, "utf8").then(
					(text) => factsOf(path, text),
					() => undefined,
				)
			: Promise.resolve(undefined);
		this.facts.set(path, facts);
		return facts;
	}
}
