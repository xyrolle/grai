import { basename, dirname } from "node:path";
import { withoutContentHash } from "./content-names.ts";
import { keyModulePrefix, textModulePrefix } from "./locale-chunks.ts";

/**
 * A module grai's client build puts in a chunk of its own. The runtime and the modules it reads
 * (`runtime`, `config`, `plurals`, `formats`) go to the `grai-runtime` chunk; a key's module
 * (`key`) and a text key's string module (`text`) go to the message chunks under `grai/`.
 */
export type GraiModuleKind =
	| "runtime"
	| "config"
	| "plurals"
	| "formats"
	| "key"
	| "text";

/**
 * The output's files that go to the `grai-runtime` chunk, with their kinds, by their names without
 * the hash of their content: the entries apps import and the modules they re-export alike.
 */
const runtimeFiles = new Map<string, GraiModuleKind>([
	["runtime.js", "runtime"],
	["internal.js", "runtime"],
	["config.js", "config"],
	["plurals.js", "plurals"],
	["formats.js", "formats"],
]);

/** The kind of the `grai-runtime` chunk's module an id is, in a project whose output is `outdir`. */
export function runtimeKindIn(
	outdir: string,
): (id: string) => GraiModuleKind | undefined {
	return (id) =>
		dirname(id) === outdir
			? runtimeFiles.get(withoutContentHash(basename(id)))
			: undefined;
}

/** Which module of grai's an id is, in a project whose output is `outdir`; nothing for any other. */
export function moduleKindIn(
	outdir: string,
): (id: string) => GraiModuleKind | undefined {
	const runtimeKind = runtimeKindIn(outdir);
	return (id) => {
		if (id.startsWith(keyModulePrefix)) return "key";
		if (id.startsWith(textModulePrefix)) return "text";
		return runtimeKind(id);
	};
}
