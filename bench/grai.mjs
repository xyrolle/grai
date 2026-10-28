// grai as the benches reach it, from this one place: the package as published, this repository's
// build (`dist`, which `pnpm build` writes), its entries where package.json's `exports` and `bin`
// map them, and the parts its benches time, from an entry of the build for them. A bench that times grai's own code running would
// otherwise charge it Node's stripping of TypeScript as each module of the source loads, which no
// app pays. A bench refuses to run on a build older than the source.
//
// On an app's catalogs grai compiles a project under .cache with a copy of the catalogs, so
// benches may edit them, and the app's strategy, so that grai's middleware resolves a request's
// locale as the app's server does. `graiServerBuild` is the output as grai's Vite plugin builds it
// for a server.
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { cacheDir } from "./apps.mjs";

const repository = new URL("../", import.meta.url).pathname;
const manifest = JSON.parse(
	readFileSync(join(repository, "package.json"), "utf8"),
);

/** The modification times of every file under a directory, none when it is missing. */
function modified(directory) {
	if (!existsSync(directory)) return [];
	return readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => statSync(join(entry.parentPath, entry.name)).mtimeMs);
}

/** Refuses a build that is missing, or that has a file older than a file of the source. */
function assertBuilt() {
	const build = modified(join(repository, "dist"));
	const source = modified(join(repository, "src"));
	if (build.length === 0 || Math.max(...source) > Math.min(...build))
		throw new Error(
			"grai's build is missing or older than its source: run pnpm build in the repository first.",
		);
}
assertBuilt();

/** An entry of the package by its path in `exports`, such as "." or "./vite", as an app imports it. */
export function graiEntry(path) {
	const target = manifest.exports[path]?.default;
	if (target === undefined)
		throw new Error(`grai's package exports no ${JSON.stringify(path)}.`);
	return join(repository, target);
}

/**
 * The parts of grai the benches time, from the build's entry for them (`src/bench.ts`), which the
 * package neither exports nor ships: the chunks an app runs, as the build bundles them.
 */
export const graiParts = join(repository, "dist", "bench.js");

/** grai's CLI, as the package's `bin` names it. */
export const graiCli = join(repository, manifest.bin.grai);

/**
 * The Vite grai's build imports, from the repository's node_modules. An app has one Vite: grai's
 * plugin tells a server environment it can patch in place by Vite's own class, so a server made by
 * another copy of Vite would have its messages taken again on every edit.
 */
export const graiVite = join(
	repository,
	"node_modules/vite/dist/node/index.js",
);

/** The strategies grai has; an app's custom ones are left out, and the base locale is grai's last resort. */
const strategies = new Set(["cookie", "preferredLanguage", "url"]);

/** Writes the project and returns its config file; the output goes to `out` beside it. */
export function writeGraiProject(app, name) {
	const directory = join(cacheDir, name, app.id);
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(join(directory, "messages"), { recursive: true });
	for (const locale of app.locales)
		cpSync(app.catalogs[locale], join(directory, "messages", `${locale}.json`));
	const { strategy, cookieName } = app.compilerOptions;
	const used = strategy.filter((source) => strategies.has(source));
	const config = join(directory, "grai.config.json");
	writeFileSync(
		config,
		JSON.stringify({
			locales: app.locales,
			baseLocale: app.baseLocale,
			catalogs: "messages/{locale}.json",
			outdir: "out",
			strategy: used,
			...(used.includes("cookie") && { cookieName }),
		}),
	);
	return config;
}

const compiled = new Map();

/** grai's output for an app, compiled once a process: its config file and its directory. */
export function graiOutput(app) {
	if (!compiled.has(app.id)) compiled.set(app.id, compileOutput(app));
	return compiled.get(app.id);
}

async function compileOutput(app) {
	const config = writeGraiProject(app, "grai-output");
	const { compile } = await import(graiEntry("."));
	const { errors } = await compile(config);
	if (errors.length > 0)
		throw new Error(errors.map((error) => error.message).join("\n"));
	return { config, outdir: join(dirname(config), "out") };
}

const built = new Map();

/**
 * grai's output for an app as its Vite plugin builds it for a server, once a process: its keys and
 * its middleware, two entries sharing one runtime, as an app's server bundle holds them. Returns
 * the build's directory, which has `keys.js` and `server.js`.
 */
export function graiServerBuild(app) {
	if (!built.has(app.id)) built.set(app.id, serverBuild(app));
	return built.get(app.id);
}

async function serverBuild(app) {
	const { config, outdir } = await graiOutput(app);
	const { grai } = await import(graiEntry("./vite"));
	const { build } = await import("vite");
	const directory = join(dirname(config), "server");
	await build({
		root: dirname(config),
		configFile: false,
		logLevel: "silent",
		plugins: [grai({ config })],
		build: {
			ssr: true,
			outDir: directory,
			rolldownOptions: {
				input: {
					keys: join(outdir, "keys.js"),
					server: join(outdir, "server.js"),
				},
			},
		},
	});
	return directory;
}
