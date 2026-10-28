// One production build of build-added.mjs's app in a process of its own, from a clean checkout:
// `node build-runs.mjs <variant> <root> [<grai's config or Paraglide's project>]`, printing as
// JSON on its last line:
// - `ms`: from before Vite and the library's plugin are imported until the build has written its
//   files, so the clock holds both imports and the plugin's construction, as `vite build` pays
//   them, and not Node's own start;
// - `buildStart`: how long the library's plugins took in `buildStart`, where both compile the
//   catalogs, timed around the plugins' own hooks, from the first one's start to the last one's end;
// - `timings`: Rolldown's own report of the plugins' hooks, which names a hook of a second or more
//   (bundler-timings.mjs).
import { rmSync } from "node:fs";
import { join } from "node:path";
import { bundlerTimings } from "./bundler-timings.mjs";
import { graiEntry } from "./grai.mjs";

/** What a build starts from, as a fresh checkout: each library's output and cache gone. */
function clean(root) {
	for (const each of [
		"dist",
		"src/i18n",
		"src/paraglide",
		"project.inlang/cache",
	])
		rmSync(join(root, each), { recursive: true, force: true });
}

/** The variant's plugins, imported and made as an app's Vite config makes them. */
async function pluginsOf(variant, root, extra) {
	if (variant === "grai")
		return (await import(graiEntry("./vite"))).grai({ config: extra });
	if (variant === "paraglide") {
		const { paraglideVitePlugin } = await import("@inlang/paraglide-js");
		return [
			paraglideVitePlugin({
				project: extra,
				outdir: join(root, "src/paraglide"),
			}),
		];
	}
	return [];
}

/**
 * Times the plugins' `buildStart` hooks, which the bundler runs side by side: returns the span from
 * the first one's start to the last one's end, once the build has run them.
 */
function timeBuildStart(plugins) {
	const starts = [];
	const ends = [];
	for (const plugin of plugins) {
		const hook = plugin.buildStart;
		if (hook === undefined) continue;
		const handler = typeof hook === "function" ? hook : hook.handler;
		async function timed(...args) {
			starts.push(performance.now());
			try {
				return await handler.apply(this, args);
			} finally {
				ends.push(performance.now());
			}
		}
		plugin.buildStart =
			typeof hook === "function" ? timed : { ...hook, handler: timed };
	}
	return () =>
		starts.length === 0 ? 0 : Math.max(...ends) - Math.min(...starts);
}

const [variant, root, extra] = process.argv.slice(2);
clean(root);
const start = performance.now();
const { build } = await import("vite");
const plugins = await pluginsOf(variant, root, extra);
const buildStart = timeBuildStart(plugins);
let timings;
const quiet = () => {};
await build({
	root,
	configFile: false,
	customLogger: {
		info: quiet,
		warn: (message) => {
			timings ??= bundlerTimings(message);
		},
		warnOnce: quiet,
		error: quiet,
		clearScreen: quiet,
		hasErrorLogged: () => false,
		hasWarned: false,
	},
	plugins,
	build: { outDir: join(root, "dist"), reportCompressedSize: false },
});
const ms = performance.now() - start;
console.log(JSON.stringify({ ms, buildStart: buildStart(), timings }));
