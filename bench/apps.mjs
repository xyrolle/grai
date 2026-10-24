// The catalogs every bench runs on. Two real apps' catalogs are read in place from the checkouts
// named by GRAI_BENCH_A and GRAI_BENCH_B, and never copied here; GRAI_BENCH_A_STRATEGY (or _B_)
// gives that app's Paraglide strategy, comma-separated. The synthetic catalog has app A's shape
// and needs nothing, so anyone can run every bench.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { writeSyntheticProject } from "./synthetic.mjs";

export const cacheDir = new URL(".cache/", import.meta.url).pathname;

const DEFAULT_STRATEGY = "cookie,baseLocale";

const roots = {
	a: process.env.GRAI_BENCH_A,
	b: process.env.GRAI_BENCH_B,
	synthetic: undefined,
};

function loadApp(name) {
	const root =
		name === "synthetic"
			? writeSyntheticProject(join(cacheDir, "synthetic"))
			: roots[name];
	const settings = JSON.parse(
		readFileSync(join(root, "project.inlang/settings.json"), "utf8"),
	);
	const pathPattern = settings["plugin.inlang.messageFormat"].pathPattern;
	const catalogs = {};
	const messages = {};
	for (const locale of settings.locales) {
		catalogs[locale] = resolve(root, pathPattern.replace("{locale}", locale));
		const { $schema, ...catalog } = JSON.parse(
			readFileSync(catalogs[locale], "utf8"),
		);
		messages[locale] = catalog;
	}
	const strategy = (
		process.env[`GRAI_BENCH_${name.toUpperCase()}_STRATEGY`] ?? DEFAULT_STRATEGY
	).split(",");
	return {
		name: name === "synthetic" ? name : `app ${name.toUpperCase()}`,
		id: name,
		root,
		baseLocale: settings.baseLocale,
		locales: settings.locales,
		catalogs,
		messages,
		compilerOptions: { strategy, cookieName: "lang" },
	};
}

/** The apps named on the command line, or every app whose checkout is configured. */
export function selectedApps(argv = process.argv.slice(2)) {
	const names = argv.filter((arg) => !arg.startsWith("-"));
	const chosen =
		names.length > 0
			? names
			: Object.keys(roots).filter(
					(name) => name === "synthetic" || roots[name],
				);
	for (const name of chosen) {
		if (!(name in roots))
			throw new Error(
				`Unknown app ${JSON.stringify(name)}: use ${Object.keys(roots).join(", ")}.`,
			);
		if (name !== "synthetic" && !roots[name])
			throw new Error(
				`Set GRAI_BENCH_${name.toUpperCase()} to the app's checkout to bench its catalogs.`,
			);
	}
	return chosen.map(loadApp);
}
