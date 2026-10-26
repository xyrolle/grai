// The refactoring commands on a whole app: check, find, rename and check --fix, each in a new
// Node process, timed once grai's modules have loaded. They run on a copy in the system's
// temporary directory, removed after: app A's or B's src/ and catalogs, from the checkouts that
// GRAI_BENCH_A and GRAI_BENCH_B name, or a synthetic project of app B's size (13,000 keys in three
// locales, 9,000 source files, 68 MB) that anyone can run. find and rename take the key the most
// files name; check --fix removes 50 unused keys added to each catalog, then checks, as the
// command does: it runs the command itself, its output kept from the terminal. Medians of three
// runs.
//   node refactor.mjs [app...]
import { execFileSync } from "node:child_process";
import {
	cpSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { graiSource } from "./grai.mjs";

const RUNS = 3;
const UNUSED = 50;
const self = new URL(import.meta.url).pathname;
const commands = {
	check: ["check.ts", "check"],
	find: ["find.ts", "find"],
	rename: ["rename.ts", "rename"],
	fix: ["cli/check.ts", "checkCommand"],
};

/**
 * Runs in the child: one command, timed after its module loads, printed as milliseconds on the
 * last line. `check --fix` is the command's own run, which prints what it removed and checked.
 */
async function child(command, config, ...args) {
	const [file, name] = commands[command];
	const exported = (await import(join(graiSource, file)))[name];
	const start = performance.now();
	if (command === "fix") {
		// Its exit code says whether the check found problems, which the parent does not judge: it
		// checks that the unused keys are gone.
		await exported.run(["--fix", "--config", config]);
		console.log(JSON.stringify({ ms: performance.now() - start }));
		return;
	}
	const result = await exported(config, ...args);
	const ms = performance.now() - start;
	const errors = Array.isArray(result) ? result : result.errors;
	if (command !== "check" && errors.length > 0) throw errors[0];
	console.log(JSON.stringify({ ms }));
}

/** The median of the runs, each after its own setup and then its check, in milliseconds. */
function median(setup, args, after = () => {}) {
	const runs = Array.from({ length: RUNS }, (_, run) => {
		setup(run);
		const output = execFileSync(
			process.execPath,
			[self, "--child", ...args(run)],
			{
				encoding: "utf8",
			},
		);
		after();
		return JSON.parse(output.trim().split("\n").at(-1) ?? "").ms;
	});
	return runs.toSorted((a, b) => a - b)[Math.floor(RUNS / 2)];
}

/** A copy of an app's sources and catalogs, with a grai config, from its checkout or made up. */
function copyOf(app, dir) {
	if (app === "synthetic") return writeSynthetic(dir);
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
	for (const locale of settings.locales) {
		const catalog = catalogs.replace("{locale}", locale);
		mkdirSync(dirname(join(dir, catalog)), { recursive: true });
		cpSync(join(root, catalog), join(dir, catalog));
	}
	return { locales: settings.locales, catalogs };
}

/** App B's size: per-key imports and namespace reads of 13,000 keys in 9,000 files. */
function writeSynthetic(dir) {
	const locales = ["en", "ro", "ru"];
	const keys = Array.from(
		{ length: 13_000 },
		(_, n) => `area${n % 97}_label_${n}`,
	);
	mkdirSync(join(dir, "messages"));
	for (const locale of locales) {
		const catalog = Object.fromEntries(
			keys.map((key) => [key, `${locale} ${key}`]),
		);
		writeFileSync(
			join(dir, "messages", `${locale}.json`),
			JSON.stringify(catalog, null, "\t"),
		);
	}
	const code =
		"\tconst total = items.reduce((sum, item) => sum + item.price, 0);\n";
	for (let n = 0; n < 9_000; n++) {
		const [a, b, c, d] = [0, 1, 2, 3].map(
			(i) => keys[(n * 7 + i * 1931) % keys.length],
		);
		const file = join(dir, "src", `area${n % 97}`, `View${n}.svelte`);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(
			file,
			`<script lang="ts">\n\timport { m } from "#lib/i18n";\n\timport { ${a} } from "#i18n/messages/${a}.js";\n${code.repeat(110)}</script>\n\n<h1>{${a}()}</h1>\n<p>{m.${b}()} {m.${c}()} {m["${d}"]()}</p>\n`,
		);
	}
	return { locales, catalogs: "messages/{locale}.json" };
}

/** The key the most source files name. */
function busiestKey(dir, catalog) {
	const keys = new Set(Object.keys(JSON.parse(readFileSync(catalog, "utf8"))));
	const files = new Map();
	for (const path of readdirSync(join(dir, "src"), {
		recursive: true,
		encoding: "utf8",
	})) {
		if (!/\.(svelte|ts|tsx|js)$/.test(path)) continue;
		const text = readFileSync(join(dir, "src", path), "utf8");
		for (const name of new Set(text.match(/[A-Za-z_$][\w$]*/g))) {
			if (keys.has(name)) files.set(name, (files.get(name) ?? 0) + 1);
		}
	}
	return [...files].reduce((best, entry) =>
		entry[1] > best[1] ? entry : best,
	)[0];
}

/** Adds unused keys at the top of each catalog, as text, so every other byte stays. */
function addUnusedKeys(dir, catalogs, locales) {
	for (const locale of locales) {
		const path = join(dir, catalogs.replace("{locale}", locale));
		const text = readFileSync(path, "utf8");
		const start = text.indexOf("\n") + 1;
		const unused = Array.from(
			{ length: UNUSED },
			(_, n) => `\t"zz_unused_${n}": "unused",\n`,
		);
		writeFileSync(
			path,
			text.slice(0, start) + unused.join("") + text.slice(start),
		);
	}
}

/** Throws unless check --fix took the unused keys out of every catalog. */
function removedUnusedKeys(dir, catalogs, locales) {
	for (const locale of locales) {
		const path = join(dir, catalogs.replace("{locale}", locale));
		if (readFileSync(path, "utf8").includes('"zz_unused_'))
			throw new Error(`check --fix left unused keys in ${path}`);
	}
}

if (process.argv[2] === "--child") {
	await child(...process.argv.slice(3));
} else {
	for (const app of process.argv.length > 2
		? process.argv.slice(2)
		: ["synthetic"]) {
		const dir = mkdtempSync(join(tmpdir(), `grai-refactor-${app}-`));
		try {
			const { locales, catalogs } = copyOf(app, dir);
			const config = join(dir, "grai.config.json");
			writeFileSync(
				config,
				JSON.stringify({
					locales,
					baseLocale: locales[0],
					catalogs,
					outdir: "src/lib/grai",
				}),
			);
			const key = busiestKey(
				dir,
				join(dir, catalogs.replace("{locale}", locales[0])),
			);
			const none = () => {};
			// The runs rename the key and back, so each renames the same call sites.
			const names = (run) =>
				run % 2 === 0 ? [key, `${key}_x`] : [`${key}_x`, key];
			const ms = {
				check: median(none, () => ["check", config]),
				find: median(none, () => ["find", config, key]),
				rename: median(none, (run) => ["rename", config, ...names(run)]),
				"check --fix": median(
					() => addUnusedKeys(dir, catalogs, locales),
					() => ["fix", config],
					() => removedUnusedKeys(dir, catalogs, locales),
				),
			};
			const times = Object.entries(ms).map(
				([name, value]) => `${name} ${value.toFixed(0)} ms`,
			);
			console.log(`${app}: ${times.join(", ")}`);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
}
