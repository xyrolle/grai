// What each library's types are read from, its catalog, in two states: as the app has it, and with
// one key added, as the library's own tool writes it: grai's and Paraglide's compiled output, and
// the JSON i18next's and use-intl's types read. Each state is a directory, under
// .cache/types/<app>/states/<library>/, which a completion sample writes into the library's
// project, as an editor's watcher sees the tool write it.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { graiEntry } from "./grai.mjs";
import { libraryCatalogs } from "./libraries.mjs";
import { paraglideOutput, resolveTypeScript6 } from "./paraglide.mjs";
import { otherLocale } from "./request.mjs";

/** The key a catalog change adds, a message without inputs. */
const added = { added_message: "Added" };

/** A plural's suffix in i18next's keys, which its types also offer the key without. */
const pluralSuffix = /_(zero|one|two|few|many|other)$/;

/**
 * The keys i18next's types offer `t`: each key of the catalog and each plural's key without its
 * suffix, alone and after the namespace, `translation:`.
 */
function i18nextKeys(catalog) {
	const keys = new Set(Object.keys(catalog));
	for (const key of [...keys]) keys.add(key.replace(pluralSuffix, ""));
	for (const key of [...keys]) keys.add(`translation:${key}`);
	return [...keys];
}

/** Adds the key to each of the grai project's catalogs, and returns their paths by locale. */
function addKey(app, root) {
	const catalogs = {};
	for (const locale of app.locales) {
		catalogs[locale] = join(root, "messages", `${locale}.json`);
		const catalog = JSON.parse(readFileSync(catalogs[locale], "utf8"));
		writeFileSync(catalogs[locale], JSON.stringify({ ...catalog, ...added }));
	}
	return catalogs;
}

/**
 * Writes each library's catalog before and after the key is added, for the grai project whose
 * config is given, and returns, by library, the directory of each state and the keys its types
 * give in each.
 */
export async function writeCatalogs(app, config) {
	const root = dirname(config);
	const state = (name, when) => join(root, "states", name, when);
	const copy = (output, name, when) =>
		cpSync(output, join(state(name, when), "out"), { recursive: true });
	const write = (name, when, file, catalog) => {
		mkdirSync(state(name, when), { recursive: true });
		writeFileSync(join(state(name, when), file), JSON.stringify(catalog));
	};
	const { compile } = await import(graiEntry("."));
	const compileGrai = async (when) => {
		const { errors } = await compile(config);
		if (errors.length > 0) throw new Error(errors[0].message);
		copy(join(root, "out"), "grai", when);
	};
	resolveTypeScript6();
	const paraglide = async (catalogs, when) =>
		copy(
			await paraglideOutput({ ...app, catalogs }, { emitTsDeclarations: true }),
			"paraglide",
			when,
		);
	const { i18next, icu } = libraryCatalogs(app, otherLocale(app));
	const keys = Object.keys(app.messages[app.baseLocale]);

	await compileGrai("before");
	await paraglide(app.catalogs, "before");
	write("i18next", "before", "translation.json", i18next);
	write("use-intl", "before", "messages.json", icu);

	const edited = addKey(app, root);
	await compileGrai("after");
	await paraglide(edited, "after");
	write("i18next", "after", "translation.json", { ...i18next, ...added });
	write("use-intl", "after", "messages.json", { ...icu, ...added });

	const states = (name) => ({
		before: state(name, "before"),
		after: state(name, "after"),
	});
	const catalogKeys = (names) => ({
		before: names,
		after: [...names, ...Object.keys(added)],
	});
	return {
		grai: { states: states("grai"), keys: catalogKeys(keys) },
		paraglide: { states: states("paraglide"), keys: catalogKeys(keys) },
		i18next: {
			states: states("i18next"),
			keys: {
				before: i18nextKeys(i18next),
				after: i18nextKeys({ ...i18next, ...added }),
			},
		},
		"use-intl": {
			states: states("use-intl"),
			keys: catalogKeys(Object.keys(icu)),
		},
	};
}
