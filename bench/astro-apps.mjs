// The same static Astro site three times, written from a catalog: on grai, on Paraglide in the
// setup its Astro guide gives for static sites, and with its words written in (no library), the
// floor. Each locale's page renders SERVER_KEYS messages in the page and CLIENT_KEYS in a Svelte
// island, chosen evenly across the catalog, so it has the catalog's share of plurals and inputs.
// Astro's i18n routing gives each locale its page, the base locale's without a prefix. Each app
// sits under bench/.cache/astro/, inside bench's own install of astro, svelte, Paraglide and grai.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@xyrolle/grai";
import { cacheDir } from "./apps.mjs";

export const SERVER_KEYS = 400;
export const CLIENT_KEYS = 100;
export const astroDir = join(cacheDir, "astro");
const installed = (path) =>
	new URL(`node_modules/${path}`, import.meta.url).pathname;

/**
 * The keys the page renders, evenly spaced, which of them the island renders, and in each the
 * first message of plain words, which the edit bench edits.
 */
export function pageKeys(app) {
	const base = app.messages[app.baseLocale];
	const keys = Object.keys(base);
	const total = SERVER_KEYS + CLIENT_KEYS;
	const chosen = Array.from(
		{ length: total },
		(_, index) => keys[Math.floor((index * keys.length) / total)],
	);
	const server = chosen.filter((_, index) => index % 5 !== 0);
	const client = chosen.filter((_, index) => index % 5 === 0);
	const plain = (key) =>
		typeof base[key] === "string" && !base[key].includes("{");
	return {
		server,
		client,
		targets: { server: server.find(plain), client: client.find(plain) },
	};
}

/** The inputs a message reads, each with a value: a count of 3, and a name. */
function inputsOf(message) {
	const source = JSON.stringify(message);
	const inputs = {};
	for (const [, name] of source.matchAll(/\{(\w+)\}/g)) inputs[name] = "Ana";
	for (const [, name] of source.matchAll(/input (\w+)/g)) inputs[name] = 3;
	return inputs;
}

/** A call of message `key` on `m`, with the inputs it reads. */
const call = (app, key) => {
	const inputs = inputsOf(app.messages[app.baseLocale][key]);
	return `m.${key}(${Object.keys(inputs).length === 0 ? "" : JSON.stringify(inputs)})`;
};

/** List items of `keys`, each `render(key)`; the edited message's item has the id `<part>-target`. */
function items(keys, render, target, part) {
	return keys
		.map((key) => {
			const id = key === target ? ` id="${part}-target"` : "";
			return `\t<li${id}>{${render(key)}}</li>`;
		})
		.join("\n");
}

const astroConfig = (
	app,
	{ imports, integrations, vite = "" },
) => `import svelte from "@astrojs/svelte";
import { defineConfig } from "astro/config";
${imports}
export default defineConfig({
	i18n: { locales: ${JSON.stringify(app.locales)}, defaultLocale: ${JSON.stringify(app.baseLocale)} },
	integrations: [${integrations}svelte()],
	${vite}
});
`;

/** A page of each locale from `src/pages/[...locale]/`, the base locale's without a prefix. */
const localePaths = (
	runtime,
) => `import { baseLocale, locales } from "${runtime}";

export function getStaticPaths() {
	return locales.map((locale) => ({ params: { locale: locale === baseLocale ? undefined : locale } }));
}`;

const page = (frontmatter, list) => `---
${frontmatter}
---

<html lang={Astro.currentLocale}>
	<head><meta charset="utf-8" /><title>bench</title></head>
	<body>
<ul>
${list}
</ul>
		<Island client:load />
	</body>
</html>
`;

function writeFiles(root, files) {
	rmSync(root, { recursive: true, force: true });
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), content);
	}
}

/** One app's files: its catalogs copied in, so an edit bench edits its own. */
function writeApp(app, name, files) {
	const root = join(astroDir, name);
	writeFiles(root, { "package.json": '{ "type": "module" }\n', ...files });
	cpSync(join(app.root, "messages"), join(root, "messages"), {
		recursive: true,
	});
	return root;
}

function writeGrai(app, keys) {
	const render = (key) => call(app, key);
	return writeApp(app, "grai", {
		"grai.config.json": JSON.stringify({
			locales: app.locales,
			baseLocale: app.baseLocale,
			catalogs: "messages/{locale}.json",
			outdir: "src/i18n",
			strategy: ["url"],
		}),
		"astro.config.mjs": astroConfig(app, {
			imports: 'import { grai } from "@xyrolle/grai/astro";',
			integrations: "grai(), ",
		}),
		"src/pages/[...locale]/index.astro": page(
			`import { m } from "../../i18n/messages.js";
import Island from "../../island.svelte";
${localePaths("../../i18n/runtime.js")}`,
			items(keys.server, render, keys.targets.server, "server"),
		),
		"src/island.svelte": `<script>
import { m } from "./i18n/messages.js";
</script>

<ul>
${items(keys.client, render, keys.targets.client, "client")}
</ul>
`,
	});
}

function writeParaglide(app, keys) {
	const render = (key) => call(app, key);
	const plugins = [
		"@inlang/plugin-message-format",
		"@inlang/plugin-m-function-matcher",
	].map((plugin) => installed(`${plugin}/dist/index.js`));
	return writeApp(app, "paraglide", {
		"project.inlang/settings.json": JSON.stringify({
			baseLocale: app.baseLocale,
			locales: app.locales,
			modules: plugins,
			"plugin.inlang.messageFormat": {
				pathPattern: "./messages/{locale}.json",
			},
		}),
		"astro.config.mjs": astroConfig(app, {
			imports: 'import { paraglideVitePlugin } from "@inlang/paraglide-js";',
			integrations: "",
			vite: `vite: {
		plugins: [
			paraglideVitePlugin({
				project: "./project.inlang",
				outdir: "./src/paraglide",
				strategy: ["url", "globalVariable", "baseLocale"],
			}),
		],
	},`,
		}),
		"src/middleware.js": `import { defineMiddleware } from "astro:middleware";
import { assertIsLocale, baseLocale, setLocale } from "./paraglide/runtime.js";

export const onRequest = defineMiddleware((context, next) => {
	setLocale(assertIsLocale(context.currentLocale ?? baseLocale));
	return next();
});
`,
		"src/pages/[...locale]/index.astro": page(
			`import { m } from "../../paraglide/messages.js";
import Island from "../../island.svelte";
${localePaths("../../paraglide/runtime.js")}`,
			items(keys.server, render, keys.targets.server, "server"),
		),
		"src/island.svelte": `<script>
import { m } from "./paraglide/messages.js";
</script>

<ul>
${items(keys.client, render, keys.targets.client, "client")}
</ul>
`,
	});
}

/** Each locale's page with its words written in, from grai's output for that locale. */
async function writePlain(app, keys, graiRoot) {
	const { m } = await import(
		pathToFileURL(join(graiRoot, "src/i18n/messages.js")).href
	);
	const files = {
		"astro.config.mjs": astroConfig(app, { imports: "", integrations: "" }),
	};
	for (const locale of app.locales) {
		const words = (key) =>
			JSON.stringify(
				m[key](inputsOf(app.messages[app.baseLocale][key]), { locale }),
			);
		const pages =
			locale === app.baseLocale ? "src/pages" : `src/pages/${locale}`;
		files[`${pages}/index.astro`] = page(
			`import Island from "${locale === app.baseLocale ? ".." : "../.."}/island-${locale}.svelte";`,
			items(keys.server, words, keys.targets.server, "server"),
		);
		files[`src/island-${locale}.svelte`] = `<ul>
${items(keys.client, words, keys.targets.client, "client")}
</ul>
`;
	}
	return writeApp(app, "plain", files);
}

/** Writes the three apps for one catalog, compiling grai's catalogs for the plain pages' words. */
export async function writeAstroApps(app) {
	const keys = pageKeys(app);
	const grai = writeGrai(app, keys);
	const result = await compile(join(grai, "grai.config.json"));
	if (result.errors.length > 0) throw result.errors[0];
	return {
		keys,
		apps: {
			grai,
			paraglide: writeParaglide(app, keys),
			plain: await writePlain(app, keys, grai),
		},
	};
}
