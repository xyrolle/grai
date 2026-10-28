// The project refactor.mjs runs the commands on, written into a directory of the system's temporary
// one: app A's or B's src/, catalogs and the files its imports resolve by (package.json and
// tsconfig), copied from the checkouts that GRAI_BENCH_A and GRAI_BENCH_B name, or a synthetic
// project of app B's size that anyone can run: 13,000 keys in three locales and 9,000 source files,
// 68 MB, each file naming four keys, one by its own path's import, two through the namespace and
// one by a string. The synthetic project has two problems, which `check` must report and only them:
// a read of a key no catalog has, and an input one locale shows and the others never do. A
// Paraglide app imports its messages from its Paraglide output's path, so grai's output goes there,
// and a key's path maps to its keys.js.
import {
	cpSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

const KEYS = 13_000;
const FILES = 9_000;
const locales = ["en", "ro", "ru"];
const keys = Array.from({ length: KEYS }, (_, n) => `area${n % 97}_label_${n}`);
/** The synthetic project's problems, by code and key. */
const problems = {
	missing: { code: "key-missing", key: "area0_nowhere_0" },
	inputs: { code: "inputs-differ", key: keys[1] },
};

/** The line and column of `index` in `text`, as grai prints a place: `line:column`, from 1. */
export function placeOf(text, index) {
	const before = text.slice(0, index);
	const line = before.split("\n").length;
	return `${line}:${index - before.lastIndexOf("\n")}`;
}

/** The four keys file `n` names: by its own path, through the namespace twice, and by a string. */
const keysOfFile = (n) =>
	[0, 1, 2, 3].map((i) => keys[(n * 7 + i * 1931) % keys.length]);

const fileOf = (n) => join("src", `area${n % 97}`, `View${n}.svelte`);

/** App B's size, every key named by some file. */
function writeSynthetic(dir) {
	mkdirSync(join(dir, "messages"));
	mkdirSync(join(dir, "src/lib"), { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: "bench",
			type: "module",
			imports: {
				"#lib/*": "./src/lib/*.ts",
				"#i18n/messages/*": "./src/lib/grai/keys.js",
			},
		}),
	);
	writeFileSync(
		join(dir, "src/lib/i18n.ts"),
		'export { m } from "./grai/messages.js";\n',
	);
	for (const locale of locales) {
		const catalog = Object.fromEntries(
			keys.map((key) => [key, `${locale} ${key}`]),
		);
		if (locale === "en") catalog[problems.inputs.key] = "en {name}";
		writeFileSync(
			join(dir, "messages", `${locale}.json`),
			JSON.stringify(catalog, null, "\t"),
		);
	}
	// Each line declares a name of its own, as code that compiles does.
	const code = Array.from(
		{ length: 110 },
		(_, n) =>
			`\tconst total${n} = items.reduce((sum, item) => sum + item.price, 0);\n`,
	).join("");
	let missingAt;
	for (let n = 0; n < FILES; n++) {
		const [a, b, c, d] = keysOfFile(n);
		const missing = n === 0 ? `<p>{m.${problems.missing.key}()}</p>\n` : "";
		const text = `<script lang="ts">\n\timport { m } from "#lib/i18n";\n\timport { ${a} } from "#i18n/messages/${a}.js";\n${code}</script>\n\n<h1>{${a}()}</h1>\n<p>{m.${b}()} {m.${c}()} {m["${d}"]()}</p>\n${missing}`;
		if (n === 0)
			missingAt = placeOf(text, text.indexOf(`m.${problems.missing.key}`) + 2);
		const file = join(dir, fileOf(n));
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
	}
	return {
		locales,
		catalogs: "messages/{locale}.json",
		outdir: "src/lib/grai",
		checked: {
			problems: [
				{ ...problems.missing, file: `${fileOf(0)}:${missingAt}` },
				...["ro", "ru"].map((locale) => ({
					...problems.inputs,
					file: `messages/${locale}.json`,
					locale,
				})),
			],
			untranslated: {},
		},
	};
}

/** A copy of app A's or B's sources and catalogs; its problems are whatever its check finds. */
function copyApp(app, dir) {
	const root = process.env[`GRAI_BENCH_${app.toUpperCase()}`];
	if (root === undefined)
		throw new Error(`set GRAI_BENCH_${app.toUpperCase()}`);
	const settings = JSON.parse(
		readFileSync(join(root, "project.inlang/settings.json"), "utf8"),
	);
	const catalogs = settings["plugin.inlang.messageFormat"].pathPattern.replace(
		/^\.\//,
		"",
	);
	const filter = (path) => !path.includes("/paraglide");
	cpSync(join(root, "src"), join(dir, "src"), { recursive: true, filter });
	// The tsconfig SvelteKit generates, which the app's extends: in .svelte-kit/ up to SvelteKit 2,
	// and as $app/tsconfig in node_modules from SvelteKit 3.
	const tsconfigs = [
		"tsconfig.json",
		".svelte-kit/tsconfig.json",
		"node_modules/$app/tsconfig.json",
	];
	for (const file of tsconfigs) {
		try {
			mkdirSync(dirname(join(dir, file)), { recursive: true });
			cpSync(join(root, file), join(dir, file));
		} catch {
			// The app has no such file.
		}
	}
	const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: "bench",
			type: "module",
			imports: {
				"#lib/paraglide/messages/*": "./src/lib/paraglide/keys.js",
				...manifest.imports,
			},
		}),
	);
	for (const locale of settings.locales) {
		const catalog = catalogs.replace("{locale}", locale);
		mkdirSync(dirname(join(dir, catalog)), { recursive: true });
		cpSync(join(root, catalog), join(dir, catalog));
	}
	return {
		locales: settings.locales,
		catalogs,
		outdir: "src/lib/paraglide",
		checked: undefined,
	};
}

/**
 * Writes the project and its config into `dir`. Returns its locales, catalogs pattern and outdir,
 * and what `check` finds in it, which a synthetic project knows and an app's leaves to its first
 * check.
 */
export function writeRefactorProject(app, dir) {
	const project = app === "synthetic" ? writeSynthetic(dir) : copyApp(app, dir);
	const { locales, catalogs, outdir } = project;
	writeFileSync(
		join(dir, "grai.config.json"),
		JSON.stringify({ locales, baseLocale: locales[0], catalogs, outdir }),
	);
	return project;
}

/** The project's source files and catalogs, by path from `dir`, with their text; not its output. */
export function snapshot(dir, { locales, catalogs, outdir }) {
	const files = new Map();
	for (const path of readdirSync(join(dir, "src"), {
		recursive: true,
		encoding: "utf8",
	})) {
		const file = join("src", path);
		if (
			/\.(svelte|ts|tsx|js|jsx)$/.test(path) &&
			!file.startsWith(`${outdir}/`)
		)
			files.set(file, readFileSync(join(dir, file), "utf8"));
	}
	for (const locale of locales) {
		const path = catalogs.replace("{locale}", locale);
		files.set(path, readFileSync(join(dir, path), "utf8"));
	}
	return files;
}

/** The key the most source files name, of the catalogs' keys. */
export function busiestKey(files, catalogs) {
	const keys = new Set(Object.keys(JSON.parse(files.get(catalogs[0]))));
	const naming = new Map();
	for (const [file, text] of files) {
		if (catalogs.includes(file)) continue;
		for (const name of new Set(text.match(/[A-Za-z_$][\w$]*/g)))
			if (keys.has(name)) naming.set(name, (naming.get(name) ?? 0) + 1);
	}
	return [...naming].reduce((best, entry) =>
		entry[1] > best[1] ? entry : best,
	)[0];
}
