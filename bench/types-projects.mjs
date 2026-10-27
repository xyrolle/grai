// The projects the types bench checks and completes keys in, under .cache/types/<app>: one
// directory per library, with its tsconfig.json, a file of 500 calls, texts.ts, and what the
// library's types are read from, its catalog, so that tsc and a language server find each project
// as an editor's would. Beside each directory, <library>.json describes it for a completion
// sample: the text after which the editor is asked to complete a key, and the keys its types give.
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sampleCalls, takesInputs } from "./calls.mjs";
import { graiSource, writeGraiProject } from "./grai.mjs";
import { i18nextValues, libraryCatalogs } from "./libraries.mjs";
import { paraglideOutput, resolveTypeScript6 } from "./paraglide.mjs";
import { otherLocale } from "./request.mjs";

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

/** A plural's suffix in i18next's keys, which its types also offer the key without. */
const pluralSuffix = /_(zero|one|two|few|many|other)$/;

/**
 * The keys i18next's types offer `t`: each key of the catalog and each plural's key without its
 * suffix, alone and after the namespace, `translation:`.
 */
function i18nextKeys(catalogKeys) {
	const keys = new Set(catalogKeys);
	for (const key of catalogKeys) keys.add(key.replace(pluralSuffix, ""));
	for (const key of [...keys]) keys.add(`translation:${key}`);
	return keys;
}

/**
 * Writes each library's project for the app and returns them: its title, its name, its
 * directory, and its description's path.
 */
export async function writeProjects(app) {
	const config = writeGraiProject(app, "types");
	const root = join(config, "..");
	const { compile } = await import(join(graiSource, "index.ts"));
	await compile(config);
	resolveTypeScript6();
	const paraglide = await paraglideOutput(app, { emitTsDeclarations: true });
	const locale = otherLocale(app);
	const { i18next, icu } = libraryCatalogs(app, locale);
	const calls = sampleCalls(app, CALLS);
	const values = (call, given = call.inputs) =>
		takesInputs(call) ? JSON.stringify(given) : "";
	const texts = (imports, write) =>
		`${imports}export const texts = [\n${calls.map((call) => `\t${write(call)},`).join("\n")}\n];\n`;
	const member = (call) => `m.${call.key}(${values(call)})`;
	const catalogKeys = Object.keys(app.messages[app.baseLocale]);
	const libraries = [
		{
			title: "grai's declarations",
			name: "grai",
			marker: "\nm.",
			keys: catalogKeys,
			texts: texts(`import { m } from "./out/messages.js";\n`, member),
			catalog: copied(join(root, "out"), "out"),
		},
		{
			title: "Paraglide's declarations",
			name: "paraglide",
			marker: "\nm.",
			keys: catalogKeys,
			texts: texts(`import { m } from "./out/messages.js";\n`, member),
			catalog: copied(paraglide, "out"),
		},
		{
			title: "i18next's CustomTypeOptions",
			name: "i18next",
			marker: '\nt("',
			keys: [...i18nextKeys(Object.keys(i18next))],
			texts: texts(
				`import i18next from "i18next";\nconst t = i18next.t;\n`,
				(call) =>
					`t(${JSON.stringify(call.key)}${takesInputs(call) ? `, ${values(call, i18nextValues(app, call.key, call.inputs))}` : ""})`,
			),
			declarations: { "i18next.d.ts": i18nextTypes },
			catalog: written("translation.json", JSON.stringify(i18next)),
		},
		{
			title: "use-intl, keys inferred from the messages",
			name: "use-intl",
			marker: '\nt("',
			keys: Object.keys(icu),
			texts: texts(
				`import { createTranslator } from "use-intl/core";\nimport messages from "./messages.json" with { type: "json" };\nconst t = createTranslator({ locale: ${JSON.stringify(locale)}, messages });\n`,
				(call) =>
					`t(${JSON.stringify(call.key)}${takesInputs(call) ? `, ${values(call)}` : ""})`,
			),
			catalog: written("messages.json", JSON.stringify(icu)),
		},
	];
	return libraries.map((library) => writeProject(root, library));
}

/** A catalog that is a directory of output, copied to `path` in a project. */
const copied = (output, path) => (directory) =>
	cpSync(output, join(directory, path), { recursive: true });

/** A catalog that is a file, written to `path` in a project. */
const written = (path, text) => (directory) =>
	writeFileSync(join(directory, path), text);

/**
 * Writes a library's directory, its catalog, declarations, texts.ts and a tsconfig.json of
 * texts.ts and the declarations, then the description beside it.
 */
function writeProject(
	root,
	{ title, name, marker, keys, texts, declarations = {}, catalog },
) {
	const directory = join(root, name);
	mkdirSync(directory, { recursive: true });
	catalog(directory);
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
		JSON.stringify({ title, directory, file: "texts.ts", marker, keys }),
	);
	return { title, name, directory, description };
}
