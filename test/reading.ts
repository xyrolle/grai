import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { onTestFinished } from "vitest";
import { readProjectCode } from "../src/code/project.ts";
import { readingOf } from "../src/code/reads.ts";
import { readConfig } from "../src/config.ts";
import { GraiError } from "../src/error.ts";

/** A project on disk with these files, grai's output in `out`, and a key, `title`. */
export function projectWith(files: Record<string, string>): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-candidates-")));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const all = {
		"grai.config.json": JSON.stringify({
			locales: ["en"],
			baseLocale: "en",
			catalogs: "messages/{locale}.json",
			outdir: "out",
		}),
		"messages/en.json": JSON.stringify({ title: "Title" }),
		"out/messages.js": 'export * as m from "./keys.js";\n',
		"out/keys.js": 'export const title = () => "Title";\n',
		...files,
	};
	for (const [path, text] of Object.entries(all)) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), text);
	}
	return dir;
}

/** The sources a project's reading reads, and the reads it finds, each by file; with a key, for it. */
export async function readingIn(
	dir: string,
	key?: string,
): Promise<{ read: string[]; reads: string[] }> {
	const { read, reads } = await fullReadingIn(dir, key);
	return { read, reads };
}

/** A project's reading as `readingIn` gives it, with the files that reach the messages. */
export async function fullReadingIn(
	dir: string,
	key?: string,
): Promise<{ read: string[]; reads: string[]; reaches: string[] }> {
	const config = readConfig(join(dir, "grai.config.json"));
	const code = await readProjectCode(config, [join(dir, "src")], { key });
	if (code instanceof GraiError) throw code;
	const { reads, reaches } = await readingOf(code);
	return {
		read: [...code.sources.keys()].map((path) => relative(dir, path)).sort(),
		reads: reads.map(({ path, key }) => `${relative(dir, path)} ${key}`).sort(),
		reaches: reaches.map(({ path }) => relative(dir, path)).sort(),
	};
}

/** The imports of the output a project's reading finds unresolved, each by file and specifier. */
export async function unresolvedIn(dir: string): Promise<string[]> {
	const config = readConfig(join(dir, "grai.config.json"));
	const code = await readProjectCode(config, [join(dir, "src")]);
	if (code instanceof GraiError) throw code;
	const { unresolved } = await readingOf(code);
	return unresolved
		.map(({ path, specifier }) => `${relative(dir, path)} ${specifier}`)
		.sort();
}
