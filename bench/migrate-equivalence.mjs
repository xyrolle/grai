// Migrates a small app per library, one on react-i18next and i18next, one on next-intl and one on
// react-intl, with `grai import` and `grai migrate`, and renders each page before and after, for
// each locale and a range of inputs. It fails on a page that renders differently, on a call
// migrate leaves, on a key of the mapping no migrated call names, and on an app that still
// imports its library. React's `<!-- -->` between adjacent texts is markup, not text, and is not
// compared. next-intl's translators are use-intl's, which run here without Next.js.
//   node migrate-equivalence.mjs
import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { rolldown } from "rolldown";
import { graiCli } from "./grai.mjs";

const bench = fileURLToPath(new URL(".", import.meta.url));
const locales = ["en", "ru", "ar"];
const counts = [0, 1, 2, 3, 5, 11, 21, 22, 101, 1000];

/** Each app: the format its catalogs import as, where they are, the modules it imports, and what runs in their place. */
const apps = [
	{
		name: "i18next",
		format: "i18next",
		catalogs: "locales",
		libraries: ["i18next", "react-i18next"],
	},
	{
		name: "next-intl",
		format: "icu",
		catalogs: "messages",
		libraries: ["next-intl", "next-intl/server"],
		replaced: {
			"next-intl": "use-intl",
			"next-intl/server": "next-intl-server.js",
		},
	},
	{
		name: "formatjs",
		format: "icu",
		catalogs: "lang",
		libraries: ["react-intl"],
	},
];

let failed = false;
for (const app of apps) {
	// Inside the bench, so the bundles' imports resolve to its node_modules.
	const dir = mkdtempSync(join(bench, ".migrate-"));
	try {
		const problems = await compared(app, dir);
		console.log(`${app.name}: ${problems.summary}`);
		for (const line of problems.lines.slice(0, 20)) console.log(`  ${line}`);
		if (problems.lines.length > 0) failed = true;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
process.exitCode = failed ? 1 : 0;

/** Migrates the app in `dir`, and renders it before and after. */
async function compared(app, dir) {
	cpSync(fileURLToPath(new URL(`migrate/${app.name}`, import.meta.url)), dir, {
		recursive: true,
	});
	writeFileSync(
		join(dir, "grai.config.json"),
		JSON.stringify({
			locales,
			baseLocale: "en",
			catalogs: "grai/{locale}.json",
			outdir: "out",
		}),
	);
	const grai = (...args) =>
		execFileSync(process.execPath, [graiCli, ...args], {
			cwd: dir,
			encoding: "utf8",
		});
	grai("import", "--from", app.format, app.catalogs);
	const original = await bundled(join(dir, "original.jsx"), app.replaced, dir);
	const report = grai("migrate", "--source", "app").trim().split("\n");
	grai("compile");
	const migrated = await bundled(join(dir, "grai.jsx"), {}, dir);
	const lines = report.slice(0, -1).map((line) => `left: ${line}`);
	lines.push(...unnamedKeys(dir), ...libraryImports(dir, app.libraries));
	let renders = 0;
	for (const locale of locales) {
		for (const props of inputs()) {
			const theirs = text(await original.render(locale, props));
			const ours = text(await migrated.render(locale, props));
			renders++;
			if (theirs !== ours) {
				lines.push(
					`${locale} ${JSON.stringify(props)}: ${JSON.stringify(theirs)} before, ${JSON.stringify(ours)} after`,
				);
			}
		}
	}
	return { summary: `${report.at(-1)}; ${renders} renders compared`, lines };
}

function* inputs() {
	for (const count of counts) {
		for (const status of ["shipped", "delivered", "lost"]) {
			yield { name: "Ana", count, sum: 1234.5, status };
		}
	}
}

/** The page's text and markup, without the comments React writes between adjacent texts. */
function text(html) {
	return html.replaceAll("<!-- -->", "");
}

/** A line for each key of the mapping that no migrated call names. */
function unnamedKeys(dir) {
	const mapping = JSON.parse(
		readFileSync(join(dir, "grai.import.json"), "utf8"),
	);
	const code = appFiles(dir)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");
	return Object.entries(mapping.keys)
		.filter(([, { key }]) => !code.includes(`m.${key}(`))
		.map(([calledBy]) => `unnamed: no migrated call names ${calledBy}`);
}

/** A line for each app module that still imports one of its library's modules. */
function libraryImports(dir, libraries) {
	return appFiles(dir).flatMap((file) => {
		const code = readFileSync(file, "utf8");
		return libraries
			.filter((library) => code.includes(`from "${library}"`))
			.map(
				(library) =>
					`imports: ${file.slice(dir.length + 1)} imports ${library}`,
			);
	});
}

function appFiles(dir) {
	return readdirSync(join(dir, "app")).map((name) => join(dir, "app", name));
}

/**
 * A page module as one file beside it, its packages left to import from the bench, and each
 * module `replaced` names imported as its stand-in: a package, or a file of the app.
 */
async function bundled(entry, replaced = {}, dir) {
	const bundle = await rolldown({
		input: entry,
		platform: "node",
		transform: { jsx: "react-jsx" },
		external: (id) =>
			!Object.hasOwn(replaced, id) &&
			!id.startsWith(".") &&
			!id.startsWith("/"),
		plugins: [
			{
				name: "stand-ins",
				resolveId(id) {
					const standIn = replaced[id];
					if (standIn === undefined) return null;
					return standIn.endsWith(".js")
						? join(dir, standIn)
						: { id: standIn, external: true };
				},
			},
		],
		logLevel: "silent",
	});
	const file = `${entry}.mjs`;
	await bundle.write({ file, format: "esm" });
	await bundle.close();
	return import(pathToFileURL(file).href);
}
