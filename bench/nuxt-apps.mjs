// The same Nuxt page (vue-page.mjs), written from a catalog: on grai/nuxt, on @nuxtjs/i18n and
// with its words written in (no library), the floor for bytes. Both libraries route each locale
// but the base under its prefix, and the page is a non-base locale's. @nuxtjs/i18n is set up as
// its docs advise: its locale files loaded lazily, the page's locale's alone, its messages
// compiled ahead of time. Each catalog's apps sit under bench/.cache/nuxt/<catalog>/, inside
// bench's own install of nuxt, @nuxtjs/i18n and grai: a module path of their own, which a process
// running several catalogs never takes for another's.
import { cpSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "grai";
import { cacheDir } from "./apps.mjs";
import {
	categoriesOf,
	expressible,
	literal,
	observer,
	pageKeys,
	shown,
	template,
	templateText,
	vueI18nMessage,
	writeFiles,
} from "./vue-page.mjs";

export const nuxtDir = join(cacheDir, "nuxt");

const nuxtConfig = (options) => `export default defineNuxtConfig({
${options}	compatibilityDate: "2026-10-01",
	devtools: { enabled: false },
	telemetry: false,
});
`;

/** Records when the app has hydrated, and the target's text changes, the same in every app. */
const benchPlugin = `export default defineNuxtPlugin((nuxtApp) => {
	nuxtApp.hook("app:suspense:resolve", () => {
		window.hydrated = performance.now();
		recordChanges();
	});
});

function recordChanges() {
${observer}}
`;

function writeGrai(app, page) {
	const root = join(nuxtDir, app.id, "grai");
	writeFiles(root, {
		"grai.config.json": JSON.stringify({
			locales: app.locales,
			baseLocale: app.baseLocale,
			catalogs: "messages/{locale}.json",
			outdir: "app/i18n",
			strategy: ["url"],
		}),
		"nuxt.config.ts": nuxtConfig('\tmodules: ["grai/nuxt"],\n'),
		"app/app.vue": "<template><NuxtPage /></template>\n",
		"app/plugins/bench.client.js": benchPlugin,
		"app/pages/index.vue": `<script setup>
import * as m from "~/i18n/keys.js";
</script>

${template(app, page, (key, inputs) => shown(`m.${key}(${Object.keys(inputs).length === 0 ? "" : literal(inputs)})`))}`,
	});
	cpSync(join(app.root, "messages"), join(root, "messages"), {
		recursive: true,
	});
	return root;
}

function writeNuxtI18n(app, page) {
	const root = join(nuxtDir, app.id, "nuxtjs-i18n");
	const files = {};
	for (const locale of app.locales) {
		const keys = Object.keys(app.messages[locale]).filter((key) =>
			expressible(app.messages[locale][key]),
		);
		files[`i18n/locales/${locale}.json`] = JSON.stringify(
			Object.fromEntries(
				keys.map((key) => [
					key,
					vueI18nMessage(app.messages[locale][key], locale),
				]),
			),
			null,
			"\t",
		);
	}
	const call = (key, inputs) => {
		if (Object.keys(inputs).length === 0) return shown(`t('${key}')`);
		return "count" in inputs
			? shown(`t('${key}', ${literal(inputs)}, ${inputs.count})`)
			: shown(`t('${key}', ${literal(inputs)})`);
	};
	const locales = app.locales.map((code) => ({ code, file: `${code}.json` }));
	writeFiles(root, {
		...files,
		"nuxt.config.ts": nuxtConfig(`	modules: ["@nuxtjs/i18n"],
	i18n: {
		locales: ${JSON.stringify(locales)},
		defaultLocale: ${JSON.stringify(app.baseLocale)},
		strategy: "prefix_except_default",
		detectBrowserLanguage: false,
	},
`),
		"i18n/i18n.config.ts": `// Each locale's plural categories, in the order its messages list their forms.
const categoriesOf = ${JSON.stringify(Object.fromEntries(app.locales.map((locale) => [locale, categoriesOf(locale)])))};

export default defineI18nConfig(() => ({
	pluralRules: Object.fromEntries(
		Object.entries(categoriesOf).map(([locale, categories]) => {
			const rules = new Intl.PluralRules(locale);
			return [locale, (count) => categories.indexOf(rules.select(count))];
		}),
	),
}));
`,
		"app/app.vue": "<template><NuxtPage /></template>\n",
		"app/plugins/bench.client.js": benchPlugin,
		"app/pages/index.vue": `<script setup>
const { t } = useI18n();
</script>

${template(app, page, call)}`,
	});
	return root;
}

/** The page with one locale's words written in, from grai's output for that locale, at its path. */
async function writePlain(app, page, locale, graiRoot) {
	const root = join(nuxtDir, app.id, "plain");
	const { m } = await import(
		pathToFileURL(join(graiRoot, "app/i18n/messages.js")).href
	);
	const words = (key, inputs) => templateText(m[key](inputs, { locale }));
	writeFiles(root, {
		"nuxt.config.ts": nuxtConfig(""),
		"app/app.vue": "<template><NuxtPage /></template>\n",
		"app/plugins/bench.client.js": benchPlugin,
		[`app/pages/${locale}/index.vue`]: template(app, page, words),
	});
	return root;
}

/** Writes the apps for one catalog, and compiles grai's catalogs for the plain page's words. */
export async function writeNuxtApps(app, locale) {
	const page = pageKeys(app);
	const grai = writeGrai(app, page);
	const result = await compile(join(grai, "grai.config.json"));
	if (result.errors.length > 0) throw result.errors[0];
	return {
		page,
		apps: {
			grai,
			"@nuxtjs/i18n": writeNuxtI18n(app, page),
			plain: await writePlain(app, page, locale, grai),
		},
	};
}
