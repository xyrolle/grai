// What the URL helpers a page calls cost in the browser, by the url strategy's options a config
// uses: a page that calls localizeHref, deLocalizeUrl, getLocale and setLocale, bundled and
// minified by Rolldown, KB brotli. Each option is a constant in config.js, which Rolldown folds, so
// a config pays only for the options it names.
//   node url-bytes.mjs
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync } from "node:zlib";
import { rolldown } from "rolldown";
import { cacheDir } from "./apps.mjs";
import { graiEntry } from "./grai.mjs";

const { compile } = await import(graiEntry("."));

const options = {
	none: {},
	localePrefix: {
		localePrefix: "always",
		strategy: ["url", "cookie"],
		cookieName: "lang",
	},
	localePrefixes: { localePrefixes: { de: "deutsch" } },
	unlocalizedPaths: { unlocalizedPaths: ["/api/**"] },
	pathnames: { pathnames: { "/about": { de: "/ueber-uns" } } },
	basePath: { basePath: "/shop" },
	domains: { domains: { en: "shop.test", de: "shop.de.test" } },
};

/** The page's bundle for a project with the url strategy and `config`'s options. */
async function pageBundle(name, config) {
	const directory = join(cacheDir, "url-bytes", name);
	rmSync(directory, { recursive: true, force: true });
	mkdirSync(join(directory, "messages"), { recursive: true });
	for (const locale of ["en", "de"]) {
		writeFileSync(
			join(directory, "messages", `${locale}.json`),
			JSON.stringify({ title: locale }),
		);
	}
	writeFileSync(
		join(directory, "grai.config.json"),
		JSON.stringify({
			locales: ["en", "de"],
			baseLocale: "en",
			catalogs: "messages/{locale}.json",
			outdir: "out",
			strategy: ["url"],
			...config,
		}),
	);
	const result = await compile(join(directory, "grai.config.json"));
	if (result.errors.length > 0) throw new Error(result.errors[0].message);
	const runtime = JSON.stringify(join(directory, "out", "runtime.js"));
	const build = await rolldown({
		input: "page",
		platform: "browser",
		plugins: [
			{
				name: "page",
				resolveId: (id) => (id === "page" ? id : null),
				load: (id) =>
					id === "page"
						? `import { localizeHref, deLocalizeUrl, getLocale, setLocale } from ${runtime};\nconsole.log(localizeHref, deLocalizeUrl, getLocale, setLocale);`
						: null,
			},
		],
		logLevel: "silent",
	});
	const { output } = await build.generate({ format: "esm", minify: true });
	await build.close();
	return output[0].code;
}

console.log("| options | URL helpers, brotli |\n|---|---|");
for (const [name, config] of Object.entries(options)) {
	const code = await pageBundle(name, config);
	console.log(`| ${name} | ${brotliCompressSync(code).length} B |`);
}
