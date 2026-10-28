import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import type { Compiler } from "./compiler-identity.ts";
import { isMissing, isRecord } from "./config.ts";
import { replaceFile } from "./replace-file.ts";

/**
 * What the outdir holds, as the compile that wrote it last recorded it: what the output was
 * compiled from, its files, and the files of earlier outputs that readers may still load.
 */
export type Manifest = {
	/** A hash of the compiler, the config and the catalogs the output was compiled from. */
	inputs: string;
	/** The compiler, with the modules its identity is the hash of, for the next process to take. */
	compiler?: Compiler;
	/** The files named by their content. */
	immutable: string[];
	/** The files with names of their own, each with the hash of what it holds. */
	mutable: Record<string, string>;
	/** The files no output names any more, each with when it stopped being named, in ms. */
	retired: Record<string, number>;
};

/** The manifest's file in the outdir's state directory. */
const manifestFile = "manifest.json";

/** The state directory's manifest, or undefined when there is none or it cannot be read. */
export async function readManifest(
	state: string,
): Promise<Manifest | undefined> {
	try {
		const manifest: unknown = JSON.parse(
			await readFile(join(state, manifestFile), "utf8"),
		);
		return isManifest(manifest) ? manifest : undefined;
	} catch (error) {
		if (error instanceof SyntaxError || isMissing(error)) return undefined;
		throw error;
	}
}

/** Writes the state directory's manifest, atomically. */
export async function writeManifest(
	state: string,
	manifest: Manifest,
): Promise<void> {
	await replaceFile(
		join(state, manifestFile),
		`${JSON.stringify(manifest)}\n`,
		state,
	);
}

/**
 * Removes the manifest, before a compile replaces a file whose content it records: a compile that
 * stops halfway then leaves no record that a later one would trust.
 */
export async function removeManifest(state: string): Promise<void> {
	await unlink(join(state, manifestFile)).catch((error: unknown) => {
		if (!isMissing(error)) throw error;
	});
}

function isManifest(value: unknown): value is Manifest {
	return (
		isRecord(value) &&
		typeof value.inputs === "string" &&
		(value.compiler === undefined || isCompiler(value.compiler)) &&
		Array.isArray(value.immutable) &&
		value.immutable.every((file) => typeof file === "string") &&
		isRecord(value.mutable) &&
		Object.values(value.mutable).every((hash) => typeof hash === "string") &&
		isRecord(value.retired) &&
		Object.values(value.retired).every((at) => typeof at === "number")
	);
}

function isCompiler(value: unknown): value is Compiler {
	return (
		isRecord(value) &&
		typeof value.identity === "string" &&
		(value.modules === undefined ||
			(Array.isArray(value.modules) &&
				value.modules.every((module) => typeof module === "string")))
	);
}
