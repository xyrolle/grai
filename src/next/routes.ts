// A Next app's routes as `next dev` compiles them: a request for a page compiles the page with the
// files of its route segments that render around it, each layout, template, loading and error UI
// from the app's root down, and the proxy compiles on its own.
import { existsSync, readdirSync } from "node:fs";
import { extname, join } from "node:path";

/** What Next compiles together: a route's page or handler and its segments' files, or the proxy. */
export type Route = { files: readonly string[] };

/** The extensions Next takes a route's files by when the app's config names none. */
export const defaultPageExtensions: readonly string[] = [
	"tsx",
	"ts",
	"jsx",
	"js",
];

/** The files a route renders: a page, or a route handler that answers without one. */
const routeFiles = new Set(["page", "route"]);

/** The files of a segment that render around each route under it. */
const segmentFiles = new Set([
	"layout",
	"template",
	"loading",
	"error",
	"not-found",
	"forbidden",
	"unauthorized",
	"default",
]);

/** The files of the app's root segment that render around every route. */
const rootFiles = new Set(["global-error", "global-not-found"]);

/** The names Next gives the proxy, beside the app: `proxy`, and `middleware` before Next 16. */
const proxyNames = new Set(["proxy", "middleware"]);

/**
 * The routes of the Next app at `root`: one for each page and route handler under its app
 * directory (`app/`, or `src/app/`), with its segments' files, and one for the proxy. A folder
 * whose name starts with `_` is private: Next routes nothing in it.
 */
export function nextRoutes(
	root: string,
	extensions: readonly string[] = defaultPageExtensions,
): Route[] {
	const named = (directory: string, names: ReadonlySet<string>) =>
		entriesOf(directory)
			.filter(
				(entry) =>
					entry.isFile() &&
					extensions.includes(extname(entry.name).slice(1)) &&
					names.has(entry.name.slice(0, -extname(entry.name).length)),
			)
			.map((entry) => join(directory, entry.name));
	const app = [join(root, "app"), join(root, "src", "app")].find((each) =>
		existsSync(each),
	);
	const routes: Route[] = [];
	const visit = (directory: string, around: readonly string[]) => {
		const here = [...around, ...named(directory, segmentFiles)];
		for (const file of named(directory, routeFiles)) {
			routes.push({ files: [file, ...here] });
		}
		for (const entry of entriesOf(directory)) {
			if (entry.isDirectory() && !entry.name.startsWith("_")) {
				visit(join(directory, entry.name), here);
			}
		}
	};
	if (app !== undefined) visit(app, named(app, rootFiles));
	const beside = app === undefined ? root : join(app, "..");
	const proxy = named(beside, proxyNames);
	if (proxy.length > 0) routes.push({ files: proxy });
	return routes;
}

/** A directory's entries, by name, so that the routes come in the same order on every system. */
const entriesOf = (directory: string) =>
	readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
		a.name < b.name ? -1 : 1,
	);
