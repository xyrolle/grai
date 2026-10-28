import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { stateDirectory } from "../src/state-directory.ts";

/** Each file of an output by its path in the outdir, with its text; grai's own state left out. */
export function outputTexts(out: string): Map<string, string> {
	const texts = new Map<string, string>();
	for (const file of readdirSync(out, {
		recursive: true,
		encoding: "utf8",
	}).sort()) {
		if (file.split("/")[0] === stateDirectory) continue;
		const path = join(out, file);
		if (statSync(path).isFile()) texts.set(file, readFileSync(path, "utf8"));
	}
	return texts;
}

/** Whether a file of an output is declarations or their map. */
export function isDeclarations(file: string): boolean {
	return file.endsWith(".d.ts") || file.endsWith(".d.ts.map");
}

/**
 * Each relative import of the output's modules whose file is not there, as `<module> -> <import>`:
 * none in an output a dev server can load whole.
 */
export function unresolvedImports(out: string): string[] {
	const unresolved: string[] = [];
	for (const [file, text] of outputTexts(out)) {
		if (!file.endsWith(".js")) continue;
		for (const [, imported] of text.matchAll(
			/(?:from|import)\s*\(?\s*"(\.{1,2}\/[^"]+)"/g,
		)) {
			if (!existsSync(join(out, dirname(file), imported ?? "")))
				unresolved.push(`${file} -> ${imported}`);
		}
	}
	return unresolved;
}
