// A page's locale script: its bytes, and what it costs a static page until its entry module runs.
// A page of a hundred messages is built with @xyrolle/grai/vite, then loaded in Chromium, in
// Romanian:
//   - as built, its locale script picking the locale from navigator.languages and writing the
//     import map and preloads of its locale's copies;
//   - with what the script writes put in the page instead, its lang, a static import map and
//     preloads, as a server that knew the locale would write them: the floor for a page with one
//     locale's words.
// Runs alternate between the two, each a fresh page served from memory, so only parsing and
// running is timed: the script, then until the page's entry module runs.
//   node page-locale.mjs
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { chromium } from "playwright-core";
import { build } from "vite";
import { graiEntry, graiModule } from "./grai.mjs";

const { localeScript } = await import(graiModule("locale-script.ts"));
const { grai } = await import(graiEntry("./vite"));

const RUNS = 31;
const THROTTLING = [1, 4];
const locales = ["ro", "ru", "en"];

/** The script's bytes for a config, minified as a build writes it. */
function scriptBytes(name, strategy) {
	const config = {
		locales,
		baseLocale: "ro",
		strategy,
		cookie: strategy.includes("cookie") ? { name: "lang" } : undefined,
		localStorageKey: strategy.includes("localStorage") ? "locale" : undefined,
		queryParameter: strategy.includes("query") ? "lng" : undefined,
		urlRouting: {
			prefixes: locales,
			localePrefix: "as-needed",
			unlocalizedPaths: [],
		},
	};
	const text = localeScript(config, true);
	return `| ${name} | ${text.length} | ${gzipSync(text).length} | ${brotliCompressSync(text).length} |`;
}

/** A static site of one page that calls a hundred messages, built with @xyrolle/grai/vite. */
async function site() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-page-locale-")));
	mkdirSync(join(dir, "messages"));
	for (const locale of locales) {
		const catalog = Object.fromEntries(
			Array.from({ length: 100 }, (_, n) => [
				`key_${n}`,
				`${locale} text ${n}`,
			]),
		);
		writeFileSync(
			join(dir, "messages", `${locale}.json`),
			JSON.stringify(catalog),
		);
	}
	writeFileSync(
		join(dir, "grai.config.json"),
		JSON.stringify({
			locales,
			baseLocale: "en",
			catalogs: "messages/{locale}.json",
			outdir: "out",
			strategy: ["cookie", "preferredLanguage"],
			cookieName: "lang",
		}),
	);
	writeFileSync(
		join(dir, "index.html"),
		`<!doctype html><html><head><meta charset="utf-8"><script type="module" src="/main.js"></script></head><body></body></html>`,
	);
	writeFileSync(
		join(dir, "main.js"),
		`window.firstModule = performance.now();
import { m } from "./out/messages.js";
document.body.textContent = [${Array.from({ length: 100 }, (_, n) => `m.key_${n}()`).join(", ")}].join(" ");
`,
	);
	await build({
		root: dir,
		configFile: false,
		logLevel: "silent",
		plugins: [grai({ localeChunks: true })],
		build: { outDir: join(dir, "dist") },
	});
	return dir;
}

/** The built page with its locale script timed, and with what the script writes put in its place. */
function pages(dist) {
	const html = readFileSync(join(dist, "index.html"), "utf8");
	const tag = /<script data-grai-chunks="([^"]*)">[\s\S]*?<\/script>/.exec(
		html,
	);
	if (tag === null) throw new Error("The built page has no locale script.");
	const chunks = JSON.parse(
		tag[1].replaceAll("&quot;", '"').replaceAll("{locale}", "ro"),
	);
	const preloads = chunks.preload
		.map((href) => `<link rel="modulepreload" crossorigin href="${href}">`)
		.join("");
	const mark = (name) => `<script>window.${name} = performance.now();</script>`;
	return {
		script: html.replace(
			tag[0],
			mark("beforeScript") + tag[0] + mark("afterScript"),
		),
		static: html
			.replace("<html>", '<html lang="ro" dir="ltr">')
			.replace(
				tag[0],
				`<script type="importmap">${JSON.stringify({ imports: chunks.imports })}</script>${preloads}`,
			),
	};
}

const median = (values) =>
	values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];

console.log("\n### The locale script's bytes, minified, for 3 locales\n");
console.log("| strategy | bytes | gzip | brotli |\n| --- | --- | --- | --- |");
console.log(
	scriptBytes("cookie, preferredLanguage", ["cookie", "preferredLanguage"]),
);
console.log(
	scriptBytes("every strategy", [
		"query",
		"cookie",
		"localStorage",
		"preferredLanguage",
		"url",
	]),
);

const dir = await site();
const dist = join(dir, "dist");
const variants = pages(dist);
const browser = await chromium.launch();
console.log(
	`\n### Until the page's entry module runs, a static page in Chromium ${browser.version()}, median of ${RUNS} loads, ms\n`,
);
console.log(
	"| CPU | static import map | locale script | of which the script runs |\n| --- | --- | --- | --- |",
);
for (const rate of THROTTLING) {
	const runs = { static: [], script: [], running: [] };
	for (let run = 0; run < RUNS; run++) {
		for (const variant of ["static", "script"]) {
			const context = await browser.newContext({ locale: "ro-MD" });
			const page = await context.newPage();
			const cdp = await context.newCDPSession(page);
			await cdp.send("Emulation.setCPUThrottlingRate", { rate });
			const requested = [];
			await page.route("https://bench.test/**", (route) => {
				const path = new URL(route.request().url()).pathname;
				requested.push(path);
				return path === "/"
					? route.fulfill({ contentType: "text/html", body: variants[variant] })
					: route.fulfill({
							contentType: "text/javascript",
							body: readFileSync(join(dist, path)),
						});
			});
			await page.goto("https://bench.test/");
			await page.waitForFunction(() =>
				document.body.textContent.startsWith("ro "),
			);
			if (!requested.some((path) => path.includes("/grai-ro/")))
				throw new Error(
					"The page loaded no Romanian copy, so it timed nothing.",
				);
			const timing = await page.evaluate(() => ({
				firstModule: window.firstModule,
				running: window.afterScript - window.beforeScript,
			}));
			runs[variant].push(timing.firstModule);
			if (variant === "script") runs.running.push(timing.running);
			await context.close();
		}
	}
	console.log(
		`| ${rate}× | ${median(runs.static).toFixed(2)} | ${median(runs.script).toFixed(2)} | ${median(runs.running).toFixed(2)} |`,
	);
}
await browser.close();
rmSync(dir, { recursive: true, force: true });
