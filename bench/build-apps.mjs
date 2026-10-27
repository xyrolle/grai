// The app `build-added` builds, three ways from one set of pages: on grai, on Paraglide, and with
// every message's text written in, so it has no i18n module at all. Each page calls its share of
// every key, as `m.key(inputs)` with the namespace from the library's messages.js, and the entry
// loads each page by a dynamic import, as a router splits its routes. The pages' code is the same
// on both libraries but for the import's path.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { cacheDir } from "./apps.mjs";
import { sampleCalls, takesInputs } from "./calls.mjs";
import { writeProject } from "./paraglide.mjs";

export const PAGES = 64;
const PER_FUNCTION = 20;

/** Every key of the app, once each, in the order `sampleCalls` shuffles them into. */
function everyCall(app) {
	const keys = Object.keys(app.messages[app.baseLocale]).length;
	const calls = sampleCalls(app, keys);
	return [...new Map(calls.map((call) => [call.key, call])).values()];
}

/** The base locale's text of a message, for the page written without i18n. */
function writtenIn(app, key) {
	const message = app.messages[app.baseLocale][key];
	if (typeof message === "string") return message;
	return Object.values(message[0].match)[0];
}

/** A page's module: its calls, 20 to a function, in the library's words or written in. */
function pageSource(app, calls, messages) {
	const call = (c, n) => {
		if (messages === undefined) return JSON.stringify(writtenIn(app, c.key));
		const inputs = takesInputs(c) ? `d[${n}]` : "";
		const message = `m.${c.key}`;
		return c.kind === "markup"
			? `${message}.parts(${inputs}).length`
			: `${message}(${inputs})`;
	};
	const lines =
		messages === undefined
			? []
			: [`import { m } from ${JSON.stringify(messages)};`];
	const parts = [];
	for (let start = 0; start < calls.length; start += PER_FUNCTION) {
		const body = calls
			.slice(start, start + PER_FUNCTION)
			.map((c, offset) => `\ts += ${call(c, start + offset)};`);
		lines.push(
			`function part${parts.length}(d) {\n\tlet s = "";\n${body.join("\n")}\n\treturn s;\n}`,
		);
		parts.push(`part${parts.length}(d)`);
	}
	lines.push(`export function render(d) {\n\treturn ${parts.join(" + ")};\n}`);
	return `${lines.join("\n")}\n`;
}

/** Writes one variant's pages and entry into `root`; `messages` is its messages.js, or none. */
function writePages(app, root, calls, messages) {
	const perPage = Math.ceil(calls.length / PAGES);
	mkdirSync(join(root, "src"), { recursive: true });
	const pages = [];
	for (let page = 0; page < PAGES; page++) {
		const own = calls.slice(page * perPage, (page + 1) * perPage);
		if (own.length === 0) break;
		const file = `page${page}.js`;
		const from = messages && `./${relative(join(root, "src"), messages)}`;
		writeFileSync(join(root, "src", file), pageSource(app, own, from));
		pages.push(`() => import("./${file}")`);
	}
	writeFileSync(
		join(root, "src", "main.js"),
		`export const pages = [\n\t${pages.join(",\n\t")},\n];\n`,
	);
}

/**
 * Writes the app's three variants and returns where each is, with grai's config and Paraglide's
 * project, and how many calls its pages make.
 */
export function writeBuildApps(app) {
	const directory = join(cacheDir, "build-added", app.id);
	rmSync(directory, { recursive: true, force: true });
	const calls = everyCall(app);
	const roots = {
		stub: join(directory, "stub"),
		grai: join(directory, "grai"),
		paraglide: join(directory, "paraglide"),
	};
	writePages(app, roots.stub, calls, undefined);
	writePages(app, roots.grai, calls, join(roots.grai, "src/i18n/messages.js"));
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
	writePages(
		app,
		roots.paraglide,
		calls,
		join(roots.paraglide, "src/paraglide/messages.js"),
	);
	const project = writeProject(app, roots.paraglide);
	return { roots, graiConfig, project, calls: calls.length };
}
