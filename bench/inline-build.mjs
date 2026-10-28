// What inlining text into Svelte's templates does to a SvelteKit app's build. It builds the app as
// `vite build` does; given a locale, with one more plugin, run before Svelte's, that inlines that
// locale's text into every component (template-inliner.mjs), and without one as it is, so both
// builds are timed alike. With a locale it prints the sites inlined and the client chunks whose
// code changed, which a build for every locale would copy per locale, and what the copies would
// cost: at least one parse and a minification per locale of each such chunk, at most a client
// build per locale. It writes each page's keys to grai-pages.json, for choosing the pages
// inline-pages.mjs times. Run it in a copy of the app, never in a checkout a dev server serves:
//   cd <app copy> && node <grai>/bench/inline-build.mjs [locale]
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { graiParts } from "./grai.mjs";
import { inlineTemplate } from "./template-inliner.mjs";

const root = process.cwd();
const locale = process.argv[2];
const fromApp = (path) => import(pathToFileURL(path).href);
const { createBuilder, minifySync, parseSync } = await fromApp(
	createRequire(join(root, "package.json")).resolve("vite"),
);
const {
	compileCatalogs,
	keyModulePrefix,
	parseCatalogs,
	readProject,
	textModulePrefix,
} = await import(graiParts);
/**
 * The key a message module holds: a key's module, or @xyrolle/grai/svelte's string of a text key.
 */
function keyOf(id) {
	for (const prefix of [keyModulePrefix, textModulePrefix])
		if (id.startsWith(prefix)) return id.slice(prefix.length);
	return undefined;
}

/** The app's messages without inputs, as their text in `locale`. */
async function textsIn(locale) {
	const project = await readProject(join(root, "grai.config.json"));
	if ("errors" in project) throw project.errors[0];
	const { catalogs, errors } = parseCatalogs(project.sources);
	if (errors.length > 0) throw errors[0];
	const { config } = project;
	const index = config.locales.indexOf(locale);
	if (index < 0) throw new Error(`${locale} is not one of ${config.locales}`);
	const texts = new Map();
	for (const [key, compiled] of compileCatalogs(config, catalogs).keys)
		if (compiled.kind === "text")
			texts.set(key, JSON.parse(compiled.variants[index]));
	return { texts, locales: config.locales.length };
}

const inlining = locale === undefined ? undefined : await textsIn(locale);
const sites = { components: 0, text: 0, attribute: 0 };
const inlined = new Set();
const inliner = {
	name: "grai-bench-inline-template",
	enforce: "pre",
	transform: {
		order: "pre",
		filter: { id: /\.svelte$/ },
		handler(code, id) {
			if (inlining === undefined || id.includes("/node_modules/")) return null;
			const result = inlineTemplate(code, inlining.texts, id);
			if (result === undefined) return null;
			if (this.environment.name === "client") {
				inlined.add(id);
				sites.components++;
				sites.text += result.sites.text;
				sites.attribute += result.sites.attribute;
			}
			return { code: result.code, map: null };
		},
	},
};

const client = { started: 0, built: 0, copies: 0, copied: 0 };
const chunks = [];
const measurer = {
	name: "grai-bench-inline-build",
	applyToEnvironment: (environment) => environment.name === "client",
	buildStart() {
		client.started = performance.now();
	},
	renderChunk(code, chunk) {
		if (!chunk.moduleIds.some((id) => inlined.has(id))) return null;
		const started = performance.now();
		parseSync(chunk.fileName, code);
		for (let copy = 0; copy < inlining.locales; copy++)
			minifySync(chunk.fileName, code);
		client.copies += performance.now() - started;
		client.copied++;
		return null;
	},
	generateBundle(_, bundle) {
		client.built = performance.now();
		for (const output of Object.values(bundle)) {
			if (output.type !== "chunk") continue;
			chunks.push({
				file: output.fileName,
				facade: output.facadeModuleId,
				imports: output.imports,
				keys: output.moduleIds.map(keyOf).filter(Boolean),
			});
		}
	},
};

const started = performance.now();
const builder = await createBuilder({
	plugins: [inliner, measurer],
	logLevel: "warn",
});
await builder.buildApp();
const build = performance.now() - started - client.copies;
const clientBuild = client.built - client.started - client.copies;

/** Each page's route and the keys its chunks hold, as SvelteKit preloads them, most keys first. */
async function pages() {
	const { manifest } = await fromApp(
		join(root, ".svelte-kit/output/server/manifest-full.js"),
	);
	const byFile = new Map(chunks.map((chunk) => [chunk.file, chunk]));
	const nodeChunk = new Map();
	for (const chunk of chunks) {
		const node = chunk.facade?.match(/\/nodes\/(\d+)\.js$/)?.[1];
		if (node !== undefined) nodeChunk.set(Number(node), chunk.file);
	}
	const keysOf = (files) => {
		const seen = new Set();
		const keys = new Set();
		const visit = (file) => {
			if (seen.has(file)) return;
			seen.add(file);
			for (const key of byFile.get(file)?.keys ?? []) keys.add(key);
			for (const imported of byFile.get(file)?.imports ?? []) visit(imported);
		};
		files.forEach(visit);
		return keys.size;
	};
	return manifest.routes
		.filter((route) => route.page)
		.map((route) => ({
			route: route.id,
			keys: keysOf(
				[...route.page.layouts, route.page.leaf]
					.filter((node) => node !== undefined)
					.map((node) => nodeChunk.get(node)),
			),
		}))
		.sort((a, b) => b.keys - a.keys);
}

writeFileSync(
	join(root, "grai-pages.json"),
	JSON.stringify(await pages(), null, "\t"),
);
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
console.log(
	`The build${locale === undefined ? "" : `, text inlined in ${locale}`}: ${seconds(build)}, its client build ${seconds(clientBuild)}, ${chunks.length} client chunks.`,
);
if (inlining !== undefined) {
	console.log(
		`Inlined: ${sites.text} text and ${sites.attribute} attribute or prop sites in ${sites.components} components.`,
	);
	console.log(
		`Copies per locale of the ${client.copied} client chunks with inlined text: ${inlining.locales * client.copied} more files; parsed and minified per locale in ${seconds(client.copies)}, or ${inlining.locales - 1} more client builds, ${seconds((inlining.locales - 1) * clientBuild)}.`,
	);
}
