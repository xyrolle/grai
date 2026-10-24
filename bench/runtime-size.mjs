// Runtime size: what the browser downloads for the runtime surface the two apps call (getLocale,
// setLocale, locales, baseLocale, isLocale, localizeHref, deLocalizeUrl), minified and gzipped:
// Paraglide's runtime for a cookie and for a URL strategy, against a sketch of grai's, in which a
// document's locale is fixed by the bundle it loads, so reading it is a constant and switching is
// a cookie and a reload. Messages are not counted; they carry their own plural rules.
//   node runtime-size.mjs
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import { cacheDir, selectedApps } from "./apps.mjs";
import { paraglideOutput, paraglideVersion } from "./paraglide.mjs";

const SURFACE = [
	"getLocale",
	"setLocale",
	"locales",
	"baseLocale",
	"isLocale",
	"localizeHref",
	"deLocalizeUrl",
];

const sketch = `
export const locales = ["ro", "ru", "en"];
export const baseLocale = locales[0];
export const isLocale = (value) => locales.includes(value);
let current = document.documentElement.lang;
export const getLocale = () => current;
export function setLocale(locale, { reload = true } = {}) {
	current = locale;
	document.cookie = \`lang=\${locale}; path=/; max-age=34560000; samesite=lax\`;
	if (reload) location.reload();
}
export function deLocalizeUrl(href) {
	const url = new URL(href, location.href);
	const [, first, ...rest] = url.pathname.split("/");
	if (first !== baseLocale && isLocale(first)) url.pathname = "/" + rest.join("/");
	return url;
}
export function localizeHref(href, { locale = current } = {}) {
	const url = deLocalizeUrl(href);
	if (locale !== baseLocale) url.pathname = "/" + locale + url.pathname;
	return url.origin === location.origin ? url.pathname + url.search + url.hash : url.href;
}
`;

async function minGzip(from) {
	const entry = `export { ${SURFACE.join(", ")} } from ${JSON.stringify(from)};`;
	const bundle = await rolldown({
		input: "entry",
		platform: "browser",
		plugins: [
			{
				name: "entry",
				resolveId: (id) => (id === "entry" ? id : null),
				load: (id) => (id === "entry" ? entry : null),
			},
		],
		logLevel: "silent",
	});
	const { output } = await bundle.generate({ format: "esm", minify: true });
	await bundle.close();
	return {
		min: Buffer.byteLength(output[0].code),
		gzip: gzipSync(output[0].code).length,
	};
}

const [app] = selectedApps(["synthetic"]);
const sketchPath = join(cacheDir, "runtime-sketch.js");
writeFileSync(sketchPath, sketch);
const rows = [
	[
		`Paraglide ${paraglideVersion}, cookie strategy`,
		join(
			await paraglideOutput(app, {
				strategy: ["cookie", "preferredLanguage", "baseLocale"],
			}),
			"runtime.js",
		),
	],
	[
		`Paraglide ${paraglideVersion}, URL strategy`,
		join(
			await paraglideOutput(app, { strategy: ["url", "baseLocale"] }),
			"runtime.js",
		),
	],
	["grai sketch, locale fixed per bundle", sketchPath],
];
console.log(
	"\n### runtime surface, bytes\n\n| runtime | min | min+gzip |\n|---|---|---|",
);
for (const [name, from] of rows) {
	const size = await minGzip(from);
	console.log(`| ${name} | ${size.min} | ${size.gzip} |`);
}
