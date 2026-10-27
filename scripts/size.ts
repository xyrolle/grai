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
 * Each one's budget, in bytes: the runtime's, and each entry's by its path in package.json's
 * exports. The runtime's is the design's 1 KB, and the 37 B that read a relative href from the
 * page's URL. An entry's is about a fifth over its size when it was set. The entries that carry the
 * compiler, set with the templates of the output's declarations beside it as files: the package's
 * own 32,551 B, ./next/config 34,496 B, ./vite 55,846 B with its locale script and the build's
 * reader of code, and with ./vite's plugins ./svelte 56,167 B, ./sveltekit/vite 56,221 B, ./astro
 * 58,675 B and ./nuxt 56,820 B. The others: ./sveltekit 711 B with its import map, and the
 * import map and preload of a dev page's keys.js, 170 B of it, which its handle writes while Vite
 * renders the page, as SvelteKit lets no plugin write into a page,
 * ./sveltekit/client 382 B, ./sveltekit/navigation 210 B, ./next 516 B, ./next/proxy 265 B,
 * ./react 413 B, ./astro/middleware 1,838 B, ./vue 426 B, ./vue/client 292 B,
 * ./astro/translated-paths 1,621 B, which a static Astro build loads to list the pages in a
 * locale's words, and ./register 744 B.
 */
const budgets: Record<string, number> = {
	runtime: 1061,
	".": 39_100,
	"./vite": 67_000,
	"./register": 900,
	"./svelte": 67_400,
	"./sveltekit": 850,
	"./sveltekit/vite": 67_500,
	"./sveltekit/client": 460,
	"./sveltekit/navigation": 250,
	"./next": 650,
	"./next/config": 41_400,
	"./next/proxy": 350,
	"./react": 500,
	"./astro": 70_400,
	"./astro/middleware": 2_200,
	"./astro/translated-paths": 1_950,
	"./vue": 520,
	"./vue/client": 350,
	"./nuxt": 68_200,
};

const root = new URL("../", import.meta.url);
/** The package's name, and its exports by path, each with the file a server loads. */
const manifest: {
	name: string;
	exports: Record<string, { default: string }>;
} = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));

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

/** A size measured: the key of its budget, the name it is shown by, and its bytes. */
type Size = { key: string; name: string; bytes: number };

/**
 * Each export's bundle, from dist, its dependencies and Node's modules left out, shown by the name
 * a project imports it by.
 */
async function entrySizes(): Promise<Size[]> {
	const sizes: Size[] = [];
	for (const [path, { default: file }] of Object.entries(manifest.exports)) {
		const bytes = await gzipped(
			fileURLToPath(new URL(file, root)),
			"node",
			(id) => !id.startsWith(".") && !isAbsolute(id),
		);
		sizes.push({ key: path, name: `${manifest.name}${path.slice(1)}`, bytes });
	}
	return sizes;
}

const sizes: Size[] = [
	{ key: "runtime", name: "runtime", bytes: await runtimeSize() },
	...(await entrySizes()),
];
let over = 0;
for (const { key, name, bytes } of sizes) {
	const budget = budgets[key];
	const verdict =
		budget === undefined
			? "no budget: add one to scripts/size.ts"
			: bytes > budget
				? `over its budget of ${budget} B`
				: `budget ${budget} B`;
	if (budget === undefined || bytes > budget) over++;
	console.log(`${name}: ${bytes} B, ${verdict}`);
}
process.exitCode = over > 0 ? 1 : 0;
