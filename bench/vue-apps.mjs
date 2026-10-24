// The same server-rendered Vue page (vue-page.mjs), written from a catalog: on grai, on vue-i18n
// with the locale's whole catalog and with only the page's keys, and with its words written in
// (no library), the floor for bytes. vue-i18n is set up as its docs advise for production:
// messages compiled ahead of time by @intlify/unplugin-vue-i18n, its runtime-only build, and only
// the page's locale loaded. Each catalog's apps sit under bench/.cache/vue/<catalog>/, inside
// bench's own install of vue, vue-i18n and grai: a module path of their own, which a process
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

export const vueDir = join(cacheDir, "vue");

const indexHtml = `<!doctype html>
<html lang="%lang%">
	<head><meta charset="utf-8" /></head>
	<body><div id="app"><!--app--></div><script type="module" src="/src/entry-client.js"></script></body>
</html>
`;

/** Mounts the page: hydrates what the server drew, or, in dev, draws it, then records when. */
const mount = (create) => `const target = document.getElementById("app");
const app = target.hasChildNodes() ? createSSRApp(Page) : createApp(Page);
${create}
app.mount(target);
window.hydrated = performance.now();
${observer}`;

function writeGrai(app, page) {
	const root = join(vueDir, app.id, "grai");
	writeFiles(root, {
		"grai.config.json": JSON.stringify({
			locales: app.locales,
			baseLocale: app.baseLocale,
			catalogs: "messages/{locale}.json",
			outdir: "src/i18n",
		}),
		"index.html": indexHtml,
		"vite.config.js": `import vue from "@vitejs/plugin-vue";
import { grai } from "grai/vite";

export default { plugins: [vue(), grai()] };
`,
		"src/Page.vue": `<script setup>
import * as m from "./i18n/keys.js";
</script>

${template(app, page, (key, inputs) => shown(`m.${key}(${Object.keys(inputs).length === 0 ? "" : literal(inputs)})`))}`,
		"src/entry-client.js": `import "grai/vue/client";
import { createApp, createSSRApp } from "vue";
import Page from "./Page.vue";

${mount("")}`,
		"src/entry-server.js": `import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { setLocale } from "./i18n/runtime.js";
import Page from "./Page.vue";

export async function render(locale) {
	setLocale(locale, { reload: false });
	return renderToString(createSSRApp(Page));
}
`,
	});
	cpSync(join(app.root, "messages"), join(root, "messages"), {
		recursive: true,
	});
	return root;
}

/**
 * vue-i18n with the locale's whole catalog, as an app loads it, or with only the page's keys,
 * picked by hand: vue-i18n cannot leave out the keys a page does not use. A catalog holds the
 * messages vue-i18n can say alike; the page uses no other.
 */
function writeVueI18n(app, page, { picked }) {
	const root = join(vueDir, app.id, picked ? "vue-i18n-picked" : "vue-i18n");
	const messages = {};
	for (const locale of app.locales) {
		const keys = picked
			? page.keys
			: Object.keys(app.messages[locale]).filter((key) =>
					expressible(app.messages[locale][key]),
				);
		const catalog = Object.fromEntries(
			keys.map((key) => [
				key,
				vueI18nMessage(app.messages[locale][key], locale),
			]),
		);
		messages[`src/locales/${locale}.json`] = JSON.stringify(
			catalog,
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
	const i18n = `createI18n({
	legacy: false,
	locale,
	messages: { [locale]: messages },
	pluralRules: { [locale]: (count) => categories.indexOf(rules.select(count)) },
})`;
	writeFiles(root, {
		...messages,
		"index.html": indexHtml,
		"vite.config.js": `import VueI18nPlugin from "@intlify/unplugin-vue-i18n/vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

export default {
	plugins: [
		vue(),
		VueI18nPlugin({
			include: [fileURLToPath(new URL("./src/locales/**", import.meta.url))],
			runtimeOnly: true,
			compositionOnly: true,
			fullInstall: false,
		}),
	],
};
`,
		"src/categories.js": `// Each locale's plural categories, in the order its messages list their forms.
export const categoriesOf = ${JSON.stringify(Object.fromEntries(app.locales.map((locale) => [locale, categoriesOf(locale)])))};
`,
		"src/Page.vue": `<script setup>
import { useI18n } from "vue-i18n";

const { t } = useI18n();
</script>

${template(app, page, call)}`,
		"src/entry-client.js": `import { createApp, createSSRApp } from "vue";
import { createI18n } from "vue-i18n";
import { categoriesOf } from "./categories.js";
import Page from "./Page.vue";

const locale = document.documentElement.lang;
const categories = categoriesOf[locale];
const rules = new Intl.PluralRules(locale);
const { default: messages } = await import(\`./locales/\${locale}.json\`);
const i18n = ${i18n};
// vue-i18n's documented hot reload of a locale's messages, which Vite would otherwise reload for.
if (import.meta.hot) {
	import.meta.hot.accept(${JSON.stringify(app.locales.map((locale) => `./locales/${locale}.json`))}, (modules) => {
		modules.forEach((module, index) => module && i18n.global.setLocaleMessage(${JSON.stringify(app.locales)}[index], module.default));
	});
}
${mount("app.use(i18n);")}`,
		"src/entry-server.js": `import { createSSRApp } from "vue";
import { createI18n } from "vue-i18n";
import { renderToString } from "vue/server-renderer";
import { categoriesOf } from "./categories.js";
import Page from "./Page.vue";

export async function render(locale) {
	const categories = categoriesOf[locale];
	const rules = new Intl.PluralRules(locale);
	const { default: messages } = await import(\`./locales/\${locale}.json\`);
	return renderToString(createSSRApp(Page).use(${i18n}));
}
`,
	});
	return root;
}

/** The page with one locale's words written in, from grai's output for that locale. */
async function writePlain(app, page, locale, graiRoot) {
	const root = join(vueDir, app.id, "plain");
	const { m } = await import(
		pathToFileURL(join(graiRoot, "src/i18n/messages.js")).href
	);
	const words = (key, inputs) => templateText(m[key](inputs, { locale }));
	writeFiles(root, {
		"index.html": indexHtml,
		"vite.config.js": `import vue from "@vitejs/plugin-vue";

export default { plugins: [vue()] };
`,
		"src/Page.vue": template(app, page, words),
		"src/entry-client.js": `import { createApp, createSSRApp } from "vue";
import Page from "./Page.vue";

${mount("")}`,
		"src/entry-server.js": `import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import Page from "./Page.vue";

export const render = () => renderToString(createSSRApp(Page));
`,
	});
	return root;
}

/** Writes the apps for one catalog, and compiles grai's catalogs for the plain page's words. */
export async function writeVueApps(app, locale) {
	const page = pageKeys(app);
	const grai = writeGrai(app, page);
	const result = await compile(join(grai, "grai.config.json"));
	if (result.errors.length > 0) throw result.errors[0];
	return {
		page,
		apps: {
			grai,
			"vue-i18n": writeVueI18n(app, page, { picked: false }),
			"vue-i18n, page's keys picked": writeVueI18n(app, page, { picked: true }),
			plain: await writePlain(app, page, locale, grai),
		},
	};
}
