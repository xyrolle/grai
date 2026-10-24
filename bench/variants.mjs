// What a page downloads on a document load when a SvelteKit build copies its message chunks once
// per locale into sibling directories and an import map points the document at its locale's copy:
// one way to ship one locale from Kit's single client build. Kit's modulepreload links still name
// the shared chunks, and an import map does not apply to modulepreload (preload.mjs), so the
// document fetches both copies unless the server rewrites its preloads too. Reads a finished
// build; changes nothing.
//   node variants.mjs <app root> <shared dir> <locale dir, with {locale}>
//   node variants.mjs ../app _app/immutable/messages/ _app/immutable/messages-{locale}/
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, constants } from "node:zlib";

const [root, shared, localeDir] = process.argv.slice(2);
const client = join(root, ".svelte-kit/output/client");
const server = join(root, ".svelte-kit/output/server");
const { manifest } = await import(
	pathToFileURL(join(server, "manifest-full.js")).href
);

const brotli = (file) =>
	existsSync(join(client, file))
		? brotliCompressSync(readFileSync(join(client, file)), {
				params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
			}).length
		: 0;
const nodeImports = (index) =>
	JSON.parse(
		readFileSync(join(server, `nodes/${index}.js`), "utf8").match(
			/export const imports = (\[[^\]]*\])/,
		)[1],
	);
const [before, after] = localeDir.replace(/\/$/, "").split("{locale}");
const locales = readdirSync(join(client, dirname(before)))
	.map((name) => `${dirname(before)}/${name}`)
	.filter((path) => path.startsWith(before) && path.endsWith(after))
	.map((path) => path.slice(before.length, path.length - after.length));
const kb = (bytes) => (bytes / 1024).toFixed(1);

const pages = [];
for (const route of manifest.routes) {
	if (!route.page) continue;
	const preloads = new Set(manifest.client.imports);
	for (const node of [...route.page.layouts, route.page.leaf])
		if (node !== undefined)
			for (const file of nodeImports(node)) preloads.add(file);
	const messages = [...preloads].filter((file) => file.startsWith(shared));
	const copy = (locale) =>
		messages.reduce(
			(sum, file) =>
				sum +
				brotli(
					localeDir.replace("{locale}", locale) + file.slice(shared.length),
				),
			0,
		);
	const largest = Math.max(...locales.map(copy));
	const sharedBytes = messages.reduce((sum, file) => sum + brotli(file), 0);
	const js = [...preloads].reduce((sum, file) => sum + brotli(file), 0);
	pages.push({ messages: messages.length, js, sharedBytes, largest });
}

pages.sort((a, b) => b.sharedBytes - a.sharedBytes);
console.log(
	`\n### message chunks per page on a document load, KB brotli (largest locale's copy; ${locales.join(", ")})\n`,
);
console.log(
	"| page, by message bytes | page JS preloaded | chunks | shared (every locale) | locale copy only | both, as Kit preloads | ",
);
console.log("|---|---|---|---|---|---|");
for (const [index, page] of pages.entries()) {
	if (index >= 10 && index !== pages.length - 1) continue;
	console.log(
		`| ${index + 1} | ${kb(page.js)} | ${page.messages} | ${kb(page.sharedBytes)} | ${kb(page.largest)} | ${kb(page.sharedBytes + page.largest)} |`,
	);
}
const sum = (field) => pages.reduce((total, page) => total + page[field], 0);
console.log(
	`\n${pages.length} pages, summed: shared ${kb(sum("sharedBytes"))} KB, locale copy ${kb(sum("largest"))} KB (${(100 * (1 - sum("largest") / sum("sharedBytes"))).toFixed(0)}% less), both ${kb(sum("sharedBytes") + sum("largest"))} KB.`,
);
