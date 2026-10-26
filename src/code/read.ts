/**
 * The one entry to reading a file's code: a script, or a component through its framework's parser,
 * as the modules it holds, each parsed by `parse.ts` into one program whose offsets
 * `fileOffset` takes back to the file. A file that does not parse is its error, at its place, never
 * a guess at its code.
 */

import { astroCode } from "./astro-code.ts";
import {
	astroParser,
	type Framework,
	frameworkOf,
	mdxParser,
	packageOf,
	svelteParser,
	vueParser,
} from "./frameworks.ts";
import { mdxCode } from "./mdx-code.ts";
import { type ESTree, parse } from "./parse.ts";
import {
	type CodeError,
	fileOffset,
	nearestFileOffset,
	type SourceCode,
	scriptCode,
} from "./source.ts";
import { svelteCode } from "./svelte-code.ts";
import { field } from "./tree.ts";
import { vueCode } from "./vue-code.ts";

/** A module of a file: its program, and the code it was parsed from. */
export type ModuleCode = { program: ESTree.Program; source: SourceCode };

export type { CodeError };

/** A file's modules, or its first error. */
export async function readCode(
	path: string,
	text: string,
): Promise<ModuleCode[] | CodeError> {
	const framework = frameworkOf(path);
	const sources =
		framework === undefined
			? [scriptCode(path, text)]
			: await componentCode(framework, text);
	if (!Array.isArray(sources)) return sources;
	const modules: ModuleCode[] = [];
	for (const source of sources) {
		const { program, errors } = parse(path, source.text, { lang: source.lang });
		const [error] = errors;
		if (error !== undefined) {
			const at = error.labels[0]?.start ?? 0;
			return {
				at: fileOffset(source, at) ?? nearestFileOffset(source, at),
				message: error.message,
			};
		}
		modules.push({ program, source });
	}
	return modules;
}

/** A component's modules through its framework's parser, or why they cannot be read. */
async function componentCode(
	framework: Framework,
	text: string,
): Promise<SourceCode[] | CodeError> {
	const missing = {
		at: 0,
		message: `grai reads ${framework === "mdx" ? "MDX documents" : "these components"} with ${packageOf(framework)}'s own parser, which the project does not install.`,
	};
	try {
		switch (framework) {
			case "svelte": {
				const parse = await svelteParser();
				return parse === undefined
					? missing
					: [svelteCode(text, await parse(text))];
			}
			case "vue": {
				const parse = await vueParser();
				return parse === undefined ? missing : [vueCode(text, parse)];
			}
			case "astro": {
				const parse = await astroParser();
				return parse === undefined ? missing : astroCode(text, parse);
			}
			case "mdx": {
				const parse = await mdxParser();
				return parse === undefined ? missing : [mdxCode(text, parse)];
			}
		}
	} catch (error) {
		return { at: errorOffset(error), message: messageOf(error) };
	}
}

/** Where a framework's parse error is: Svelte's `position`, Vue's `loc`, MDX's `place`. */
function errorOffset(error: unknown): number {
	const [position] = [field(error, "position")].flat();
	const offset =
		position ??
		field(field(field(error, "loc"), "start"), "offset") ??
		field(field(error, "place"), "offset");
	return typeof offset === "number" ? offset : 0;
}

function messageOf(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.split("\n")[0] ?? message;
}
