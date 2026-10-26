// The package's sizes against their budgets, for CI, minified and gzipped:
// - the runtime as a page holds it: its whole API, and the dispatcher behind a message of each kind;
// - each entry of package.json's exports, bundled as a server holds it.
// It fails when one is over its budget, or has none.
//
// usage: pnpm build && node scripts/size.ts
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import { build } from "vite";
import { grai } from "../src/vite.ts";

/**
 * Each one's budget, in bytes. The runtime's is the design's 1 KB, and the 37 B that read a
 * relative href from the page's URL. An entry's is about a fifth over its
 * size when it was set. The entries that carry the compiler, set with the templates of the output's
 * declarations beside it as files: grai 32,551 B, grai/next/config 34,496 B, grai/vite 55,846 B
 * with its locale script and the build's reader of code, and with grai/vite's plugins grai/svelte
 * 56,167 B, grai/sveltekit/vite 56,221 B, grai/astro 58,675 B and grai/nuxt 56,820 B. The others: grai/sveltekit 541 B
 * with its import map, grai/sveltekit/client 382 B, grai/sveltekit/navigation 210 B, grai/next
 * 516 B, grai/next/proxy 265 B, grai/react 413 B, grai/astro/middleware 1,838 B, grai/vue 426 B,
 * grai/vue/client 292 B, grai/astro/translated-paths 1,621 B, which a static Astro build loads
 * to list the pages in a locale's words, and grai/register 744 B.
 */
const budgets: Record<string, number> = {
	runtime: 1061,
	grai: 39_100,
	"grai/vite": 67_000,
	"grai/register": 900,
	"grai/svelte": 67_400,
	"grai/sveltekit": 650,
	"grai/sveltekit/vite": 67_500,
	"grai/sveltekit/client": 460,
	"grai/sveltekit/navigation": 250,
	"grai/next": 650,
	"grai/next/config": 41_400,
	"grai/next/proxy": 350,
	"grai/react": 500,
	"grai/astro": 70_400,
	"grai/astro/middleware": 2_200,
	"grai/astro/translated-paths": 1_950,
	"grai/vue": 520,
	"grai/vue/client": 350,
	"grai/nuxt": 68_200,
};

const root = new URL("../", import.meta.url);
const exported: Record<string, { default: string }> = JSON.parse(
	readFileSync(new URL("package.json", root), "utf8"),
).exports;

/** A bundle of `entry`'s code, minified, with the modules `external` names left out. */
async function gzipped(
	entry: string,
	platform: "browser" | "node",
	external: (id: string) => boolean = () => false,
): Promise<number> {
	const bundle = await rolldown({
		input: entry,
		platform,
		external,
		logLevel: "silent",
	});
	const { output } = await bundle.generate({ format: "esm", minify: true });
	await bundle.close();
	return output.reduce(
		(total, chunk) =>
			total + (chunk.type === "chunk" ? gzipSync(chunk.code).length : 0),
		0,
	);
}

/**
 * The runtime's chunk in a client build of two-locale pages that use the runtime's whole API and a
 * message of each kind: a text, a message with an input, and one with markup. The chunk holds the
 * runtime and its config, and no message.
 */
async function runtimeSize(): Promise<number> {
	// Its real path, as Vite names modules by theirs: the temporary directory can be a symlink.
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-size-")));
	try {
		mkdirSync(join(dir, "messages"));
		const catalogs = {
			en: { title: "Cart", greeting: "Hi {name}", terms: "{#b}Terms{/b}" },
			de: { title: "Korb", greeting: "Hallo {name}", terms: "{#b}AGB{/b}" },
		};
		for (const [locale, catalog] of Object.entries(catalogs)) {
			writeFileSync(
				join(dir, "messages", `${locale}.json`),
				JSON.stringify(catalog),
			);
		}
		writeFileSync(
			join(dir, "grai.config.json"),
			JSON.stringify({
				locales: ["en", "de"],
				baseLocale: "en",
				catalogs: "messages/{locale}.json",
				outdir: "out",
				strategy: ["cookie", "url"],
				cookieName: "lang",
			}),
		);
		const api = [
			"GraiError",
			"assertIsLocale",
			"baseLocale",
			"deLocalizeUrl",
			"extractLocaleFromUrl",
			"getLocale",
			"getTextDirection",
			"isLocale",
			"locales",
			"localizeHref",
			"localizeUrl",
			"setLocale",
		].join(", ");
		const page = `import { ${api} } from "./out/runtime.js";
import { m } from "./out/messages.js";
globalThis.page = [${api}, m.title, m.greeting, m.terms];
`;
		// Two pages, as the runtime's chunk of its own is one that pages share.
		const pages = ["cart", "home"].map((name) => join(dir, `${name}.js`));
		for (const file of pages) writeFileSync(file, page);
		const output = await build({
			root: dir,
			configFile: false,
			logLevel: "silent",
			plugins: [grai()],
			build: { write: false, rolldownOptions: { input: pages } },
		});
		const chunks = (Array.isArray(output) ? output : [output]).flatMap(
			(result) => ("output" in result ? result.output : []),
		);
		return chunks.reduce(
			(total, chunk) =>
				total +
				(chunk.type === "chunk" && chunk.name === "grai-runtime"
					? gzipSync(chunk.code).length
					: 0),
			0,
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

/** Each export's bundle, from dist, its dependencies and Node's modules left out. */
async function entrySizes(): Promise<[string, number][]> {
	const sizes: [string, number][] = [];
	for (const [path, { default: file }] of Object.entries(exported)) {
		const name = path === "." ? "grai" : `grai/${path.slice(2)}`;
		const size = await gzipped(
			fileURLToPath(new URL(file, root)),
			"node",
			(id) => !id.startsWith(".") && !isAbsolute(id),
		);
		sizes.push([name, size]);
	}
	return sizes;
}

const sizes: [string, number][] = [
	["runtime", await runtimeSize()],
	...(await entrySizes()),
];
let over = 0;
for (const [name, size] of sizes) {
	const budget = budgets[name];
	const verdict =
		budget === undefined
			? "no budget: add one to scripts/size.ts"
			: size > budget
				? `over its budget of ${budget} B`
				: `budget ${budget} B`;
	if (budget === undefined || size > budget) over++;
	console.log(`${name}: ${size} B, ${verdict}`);
}
process.exitCode = over > 0 ? 1 : 0;
