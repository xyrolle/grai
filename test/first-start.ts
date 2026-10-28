import {
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { stateDirectory } from "../src/state-directory.ts";

/**
 * Makes a project's next dev start a first one, as after a clone or an upgrade of grai: no build
 * saved for its watcher to start from, so the dev server serves its first page before it writes
 * the output. With `held`, another writer holds the outdir's lock, so the output stays unwritten
 * until `release` is called.
 */
export function firstStart(
	outdir: string,
	{ held = false }: { held?: boolean } = {},
): { release: () => void } {
	const state = join(outdir, stateDirectory);
	rmSync(join(state, "build"), { force: true });
	const lock = join(state, "lock");
	if (held) {
		mkdirSync(state, { recursive: true });
		writeFileSync(lock, String(process.pid));
	}
	return { release: () => rmSync(lock, { force: true }) };
}

/**
 * A key whose input no value suits in every locale, in each of an example's catalogs: a list in
 * English and a number in the others. The compile a dev server serves its first page from leaves
 * that error to the output's write. Taken out again by the returned function.
 */
export function conflictingInput(
	messages: string,
	key = "conflicting",
): () => void {
	const before = new Map<string, string>();
	for (const name of readdirSync(messages).filter((file) =>
		file.endsWith(".json"),
	)) {
		const file = join(messages, name);
		const text = readFileSync(file, "utf8");
		before.set(file, text);
		const message = name === "en.json" ? "{x :list}" : "{x :number}";
		writeFileSync(
			file,
			`${JSON.stringify({ ...JSON.parse(text), [key]: message }, null, "\t")}\n`,
		);
	}
	return () => {
		for (const [file, text] of before) writeFileSync(file, text);
	};
}

/** The error the catalogs `conflictingInput` makes are shown with, in part, where Romanian follows English. */
export const conflictingInputError =
	"x is formatted as a list in en and is formatted as a number in ro, and no value suits both.";
