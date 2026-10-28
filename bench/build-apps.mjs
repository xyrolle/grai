// The app `build-added` builds, three ways from one set of pages: on grai, on Paraglide, and with
// every message's text written in, so it has no i18n module at all. Its index.html loads a router
// that imports the page its path names by a dynamic import, as an app splits its routes, and draws
// the texts that page's `render` returns into the document, so a build must keep every page and
// every call in it. Each page calls its share of every key once, as `m.key(inputs)` with the
// namespace of the library's messages.js, a message with markup drawn from its parts, its inputs
// handed down by the router as a component's props are. The page without i18n returns the same
// texts written in: the base locale's (reference-texts.mjs), which both libraries' pages draw,
// since nothing names another locale. The pages' code is the same on both libraries but for the
// import's path.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cacheDir } from "./apps.mjs";
import { takesInputs } from "./calls.mjs";
import { writeProject } from "./paraglide.mjs";
import { everyKey, referenceTexts } from "./reference-texts.mjs";

export const PAGES = 64;
const PER_FUNCTION = 20;
const callValues = new URL("call-values.mjs", import.meta.url).pathname;

/** A call in the library's words, its inputs at its place `n` in the page's `d`. */
function libraryCall(call, n) {
	const inputs = takesInputs(call) ? `d[${n}]` : "";
	return call.kind === "markup"
		? `show(m.${call.key}.parts(${inputs}))`
		: `m.${call.key}(${inputs})`;
}

/**
 * A page's module: its calls 20 to a function, each returning its texts, in the library's words
 * from `messages`, or written in when there is none.
 */
function pageSource({ calls, texts }, messages) {
	const lines =
		messages === undefined
			? []
			: [
					`import { show } from ${JSON.stringify(callValues)};`,
					`import { m } from ${JSON.stringify(messages)};`,
				];
	const parts = [];
	for (let start = 0; start < calls.length; start += PER_FUNCTION) {
		const items = calls
			.slice(start, start + PER_FUNCTION)
			.map((call, offset) =>
				messages === undefined
					? JSON.stringify(texts[start + offset])
					: libraryCall(call, start + offset),
			);
		lines.push(
			`function part${parts.length}(d) {\n\treturn [\n\t\t${items.join(",\n\t\t")},\n\t];\n}`,
		);
		parts.push(`...part${parts.length}(d)`);
	}
	lines.push(`export function render(d) {\n\treturn [${parts.join(", ")}];\n}`);
	return `${lines.join("\n")}\n`;
}

/** The router: the page at `/<index>`, its texts drawn as the list's items once it has loaded. */
const router = (pages) => `import { inputs } from "./inputs.js";

const pages = [
	${pages.map((_, index) => `() => import("./page${index}.js")`).join(",\n\t")},
];
const index = Number(location.pathname.slice(1));
pages[index]?.().then(({ render }) => {
	const items = render(inputs[index]).map((text) =>
		Object.assign(document.createElement("li"), { textContent: text }),
	);
	document.getElementById("texts").replaceChildren(...items);
	window.rendered = index;
});
`;

/**
 * Writes one variant's document, router and pages into `root`; `messages` is its messages.js, or
 * none.
 */
function writeApp(app, root, pages, messages) {
	const src = join(root, "src");
	mkdirSync(src, { recursive: true });
	writeFileSync(
		join(root, "index.html"),
		`<!doctype html><html lang="${app.baseLocale}"><head><meta charset="utf-8"><title>bench</title></head><body><ol id="texts"></ol><script type="module" src="/src/main.js"></script></body></html>\n`,
	);
	writeFileSync(join(src, "main.js"), router(pages));
	const inputs = pages.map(({ calls }) =>
		calls.map((call) => (takesInputs(call) ? call.inputs : null)),
	);
	writeFileSync(
		join(src, "inputs.js"),
		`export const inputs = ${JSON.stringify(inputs)};\n`,
	);
	const from = messages && `./${relative(src, messages)}`;
	for (const [index, page] of pages.entries())
		writeFileSync(join(src, `page${index}.js`), pageSource(page, from));
}

/**
 * Writes the app's three variants. Returns where each is, grai's config and Paraglide's project,
 * how many calls the pages make, and each page's texts, which its built page must draw.
 */
export async function writeBuildApps(app) {
	const directory = join(cacheDir, "build-added", app.id);
	rmSync(directory, { recursive: true, force: true });
	const calls = everyKey(app);
	const texts = (await referenceTexts(app, calls))[app.baseLocale];
	const perPage = Math.ceil(calls.length / PAGES);
	const pages = Array.from({ length: PAGES }, (_, page) => ({
		calls: calls.slice(page * perPage, (page + 1) * perPage),
		texts: texts.slice(page * perPage, (page + 1) * perPage),
	})).filter((page) => page.calls.length > 0);
	const roots = {
		stub: join(directory, "stub"),
		grai: join(directory, "grai"),
		paraglide: join(directory, "paraglide"),
	};
	writeApp(app, roots.stub, pages, undefined);
	writeApp(app, roots.grai, pages, join(roots.grai, "src/i18n/messages.js"));
	const graiConfig = join(roots.grai, "grai.config.json");
	writeFileSync(
		graiConfig,
		JSON.stringify({
			locales: app.locales,
			baseLocale: app.baseLocale,
			catalogs: app.catalogs[app.baseLocale].replace(
				`${app.baseLocale}.json`,
				"{locale}.json",
			),
			outdir: "src/i18n",
		}),
	);
	writeApp(
		app,
		roots.paraglide,
		pages,
		join(roots.paraglide, "src/paraglide/messages.js"),
	);
	const project = writeProject(app, roots.paraglide);
	return {
		roots,
		graiConfig,
		project,
		calls: calls.length,
		pages: pages.map((page) => page.texts),
	};
}
