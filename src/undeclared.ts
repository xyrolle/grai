/**
 * The write of an output's modules before their declarations, for a dev server that reads the
 * output from the disk, as `next dev` does, before its first page (`watch`'s `declareLater`). It
 * is in a module of its own, which only Next's watch loads, so no other adapter's bundle holds it.
 */

import { randomUUID } from "node:crypto";
import type { Compilation } from "./compilation.ts";
import {
	type CompiledProject,
	type CompileOptions,
	type CompileResult,
	placedRender,
	published,
	type Undeclared,
} from "./compile.ts";
import type { Config } from "./config.ts";
import { GraiError } from "./error.ts";
import { inputsOf } from "./output-inputs.ts";
import type { RenderedModules } from "./output-modules.ts";
import {
	type Output,
	type OutputFile,
	outputOf,
	placed,
	type Rendered,
	type ShardFiles,
	textsByPath,
} from "./render.ts";
import { type KeyGroups, savedGroups } from "./saved-groups.ts";

/**
 * Writes a compiled project's output without its keys' declarations, left undeclared by its
 * compile (`compileProject` with `declare` false), as a dev server that reads the output from the
 * disk needs only its modules before its first page: every module, whole, and none of the
 * declarations or their maps. The manifest records it as so written, by an id of its own
 * (`Publication`), and no check takes it for the output of its config and catalogs until
 * `writeBuild`, given what this returns, has declared the keys and written the rest, which names
 * the modules alike (`renderUndeclared`), unless another write replaced it first.
 */
export async function writeUndeclared(
	compiled: CompiledProject,
	{ localeCopies = false, placing }: CompileOptions = {},
): Promise<{ result: CompileResult; undeclared?: Undeclared }> {
	const { config } = compiled;
	const saved = savedGroups(config.outdir);
	const { output, rendered, placement } = await placedRender(
		compiled.compilation,
		saved,
		placing,
		(by, last) =>
			renderUndeclared(
				config,
				compiled.rendered,
				compiled.compilation,
				by,
				last,
			),
		undefined,
	);
	const id = randomUUID();
	const done = await published(
		config.outdir,
		output,
		inputsOf(config, compiled.hashes, localeCopies, placement),
		placement !== saved ? placement : undefined,
		{ undeclared: id },
	);
	if (done instanceof GraiError)
		return { result: { written: [], errors: [done] } };
	if ("superseded" in done) return { result: { written: [], errors: [] } };
	return {
		result: { written: done.written, errors: [] },
		undeclared: { id, groups: placement, rendered },
	};
}

/**
 * The output as `renderOutput` renders it, but without any declarations or their maps, for keys
 * compiled but not declared yet: every module the output's modules import, whole, as a dev server
 * starting from it needs, its declarations left to the write after (`writeBuild`). A module is
 * named by its shape, which its declarations do not change, so the write after names it alike and
 * writes no module again.
 */
function renderUndeclared(
	config: Config,
	rendered: RenderedModules,
	compilation: Compilation,
	groups: KeyGroups,
	previous?: Rendered,
): { output: Output; rendered: Rendered } {
	const places = placed(config, rendered, compilation, groups, previous);
	const shardFiles = new Map<number, ShardFiles>();
	for (const { index, module } of places.modules) {
		const { name, module: text, moduleHash } = module;
		shardFiles.set(index, { name, module: text, moduleHash });
	}
	const whole = outputOf(rendered, places, shardFiles);
	// The declarations a dev server never imports: the runtime's, the entries', the keys'.
	const modules = ([path]: OutputFile) => !path.endsWith(".d.ts");
	const output: Output = {
		immutable: whole.output.immutable.filter(modules),
		keyModules: whole.output.keyModules,
		mutable: whole.output.mutable.filter(modules),
	};
	return {
		output,
		rendered: {
			...whole.rendered,
			files: textsByPath(output.immutable, output.keyModules, output.mutable),
		},
	};
}
