import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { isMissing, isRecord } from "./config.ts";
import { replaceFile } from "./replace-file.ts";

/**
 * What the outdir holds, as the compile that wrote it last recorded it: what the output was
 * compiled from, and its files, each with a hash of what it holds.
 */
export type Manifest = {
	/** A hash of the compiler, the config and the catalogs the output was compiled from. */
	inputs: string;
	files: Record<string, string>;
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
		isRecord(value.files) &&
		Object.values(value.files).every((hash) => typeof hash === "string")
	);
}
