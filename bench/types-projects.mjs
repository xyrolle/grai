// The projects the types bench checks and completes keys in, under .cache/types/<app>: one
// directory per library, with its tsconfig.json, a file of 500 calls, texts.ts, and its catalog
// (types-catalogs.mjs), so that tsc and a language server find each project as an editor's would.
// Beside each directory, <library>.json describes it for a completion sample: the text after which
// the editor is asked to complete a key, the edits it makes, and the keys the library's types give
// before and after the catalog changes.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sampleCalls, takesInputs } from "./calls.mjs";
import { writeGraiProject } from "./grai.mjs";
import { i18nextValues } from "./libraries.mjs";
import { otherLocale } from "./request.mjs";
import { writeCatalogs } from "./types-catalogs.mjs";

export const CALLS = 500;

const compilerOptions = {
	target: "es2024",
	module: "nodenext",
	strict: true,
	noEmit: true,
	skipLibCheck: true,
	resolveJsonModule: true,
};

const i18nextTypes = `import "i18next";
import type translation from "./translation.json" with { type: "json" };
declare module "i18next" {
	interface CustomTypeOptions {
		resources: { translation: typeof translation };
	}
}
`;

/** Writes each library's project for the app and returns them, as described, with the description's path. */
export async function writeProjects(app) {
	const config = writeGraiProject(app, "types");
	const root = dirname(config);
	const catalogs = await writeCatalogs(app, config);
	const locale = otherLocale(app);
	const calls = sampleCalls(app, CALLS);
	const values = (call, given = call.inputs) =>
		takesInputs(call) ? JSON.stringify(given) : "";
	const member = (call) => `m.${call.key}(${values(call)})`;
	const libraries = [
		{
			title: "grai's declarations",
			name: "grai",
			marker: "\nm.",
			imports: `import { m } from "./out/messages.js";\n`,
			write: member,
		},
		{
			title: "Paraglide's declarations",
			name: "paraglide",
			marker: "\nm.",
			imports: `import { m } from "./out/messages.js";\n`,
			write: member,
		},
		{
			title: "i18next's CustomTypeOptions",
			name: "i18next",
			marker: '\nt("',
			imports: `import i18next from "i18next";\nconst t = i18next.t;\n`,
			write: (call) =>
				`t(${JSON.stringify(call.key)}${takesInputs(call) ? `, ${values(call, i18nextValues(app, call.key, call.inputs))}` : ""})`,
			declarations: { "i18next.d.ts": i18nextTypes },
		},
		{
			title: "use-intl, keys inferred from the messages",
			name: "use-intl",
			marker: '\nt("',
			imports: `import { createTranslator } from "use-intl/core";\nimport messages from "./messages.json" with { type: "json" };\nconst t = createTranslator({ locale: ${JSON.stringify(locale)}, messages });\n`,
			write: (call) =>
				`t(${JSON.stringify(call.key)}${takesInputs(call) ? `, ${values(call)}` : ""})`,
		},
	];
	const plain = calls.find((call) => !takesInputs(call));
	return libraries.map(({ write, imports, ...library }) =>
		writeProject(root, {
			...library,
			...catalogs[library.name],
			texts: `${imports}export const texts = [\n${calls.map((call) => `\t${write(call)},`).join("\n")}\n];\n`,
			prefix: plain.key.slice(0, 2),
			call: `${write(plain)};`,
		}),
	);
}

/**
 * Writes a library's directory, its declarations, texts.ts and a tsconfig.json of texts.ts and the
 * declarations, then the description beside it. A sample writes the catalog in.
 */
function writeProject(root, { name, texts, declarations = {}, ...project }) {
	const directory = join(root, name);
	mkdirSync(directory, { recursive: true });
	for (const [path, text] of Object.entries(declarations))
		writeFileSync(join(directory, path), text);
	writeFileSync(join(directory, "texts.ts"), texts);
	writeFileSync(
		join(directory, "tsconfig.json"),
		JSON.stringify({
			compilerOptions,
			files: [...Object.keys(declarations), "texts.ts"],
		}),
	);
	const description = join(root, `${name}.json`);
	writeFileSync(
		description,
		JSON.stringify({ ...project, directory, file: "texts.ts" }),
	);
	return { ...project, name, directory, description };
}
