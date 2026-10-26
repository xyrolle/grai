// Builds the Astro example in its directory, as `astro build` does, with one more integration,
// which keeps the pages Astro tells integrations it built, as a sitemap reads them, and prints
// their paths as JSON.
//   node test/astro-build-pages.js   (in examples/astro)
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const astro = createRequire(`${process.cwd()}/package.json`).resolve("astro");
const { build } = await import(pathToFileURL(astro).href);
/** @type {string[]} */
let pages = [];
await build({
	root: process.cwd(),
	logLevel: "error",
	integrations: [
		{
			name: "pages",
			hooks: {
				"astro:build:done": (done) => {
					pages = done.pages.map((page) => page.pathname);
				},
			},
		},
	],
});
console.log(JSON.stringify(pages));
