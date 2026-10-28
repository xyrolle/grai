import { basename, extname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { NextConfig } from "next";
import {
	PHASE_DEVELOPMENT_SERVER,
	PHASE_PRODUCTION_BUILD,
} from "next/constants.js";
import { baseDisagreement } from "../base-agreement.ts";
import { type CompileResult, compile, isCompiled } from "../compile.ts";
import { type Config, readConfig } from "../config.ts";
import { GraiError } from "../error.ts";
import { packageName } from "../package-name.ts";
import type { AppData } from "./app-data.ts";
import { count, reportErrors } from "./errors.ts";
import { defaultPageExtensions } from "./routes.ts";
import { watchStarted } from "./watch-start.ts";

/**
 * The name @xyrolle/grai/next imports the project's compiled output by, in every layer Next
 * bundles.
 */
const output = `${packageName}/next/output`;

/** What withGrai takes besides Next's config: the grai config's file, grai.config.json by default. */
export type WithGraiOptions = { config?: string };

/**
 * Wraps a Next config for grai, with grai.config.json in the project's directory, or the file
 * `options.config` names. `next dev` compiles the catalogs and recompiles on each change; `next
 * build` compiles them and fails on any error. Both bundlers then resolve @xyrolle/grai/next's
 * imports of the output to the config's outdir. Any other command bundles nothing, and gets the
 * config as it is. A Next `basePath` other than grai's is refused under the `url` strategy.
 */
export function withGrai(
	nextConfig: NextConfig = {},
	options: WithGraiOptions = {},
): (phase: string) => Promise<NextConfig> {
	return async (phase) => {
		const dev = phase === PHASE_DEVELOPMENT_SERVER;
		if (!dev && phase !== PHASE_PRODUCTION_BUILD) return nextConfig;
		const configFile = resolve(options.config ?? "grai.config.json");
		const config = readConfig(configFile);
		checkBasePath(nextConfig, config, configFile);
		const { outdir } = config;
		if (dev) {
			await watching({
				configFile,
				pageExtensions: nextConfig.pageExtensions ?? [...defaultPageExtensions],
			});
		} else built(await compile(configFile));
		return resolvingOutput(nextConfig, outdir);
	};
}

/** The watch of this process: Next asks for its config more than once, and it starts once. */
let watched: Promise<void> | undefined;

function watching(data: AppData): Promise<void> {
	watched ??= startWatching(data);
	return watched;
}

/** The watch's module, beside this one and in its form: TypeScript in the sources, JavaScript built. */
const watchWorker = new URL(
	`./watch-worker${extname(fileURLToPath(import.meta.url))}`,
	import.meta.url,
);

/**
 * Watches on a thread of its own (`watch-worker.ts`), and settles once the output can be read
 * (`watch-start.ts`): at once when it is current, and else once the watch has started, with the keys
 * placed by their groups when the watch read them beside its first compile in time
 * (`first-groups.ts`). Either way the catalogs compile once.
 */
async function startWatching(data: AppData): Promise<void> {
	// The watch runs grai's own modules, which take none of the process's flags, and a worker refuses
	// some of them, such as `--input-type`. Its thread starts while the output is checked, and what
	// it starts first, the read of the groups on a fresh clone, is done the sooner (`watch-worker.ts`).
	const worker = new Worker(watchWorker, { workerData: data, execArgv: [] });
	// Next's server holds its process. Other processes read the config for `next dev` too, as
	// Next's telemetry flush does when the server stops, and must be free to exit.
	worker.unref();
	await watchStarted(worker, () => isCompiled(data.configFile));
}

/** Refuses a Next `basePath` other than grai's, under the `url` strategy (`base-agreement.ts`). */
function checkBasePath(
	nextConfig: NextConfig,
	config: Config,
	configFile: string,
): void {
	const problem = baseDisagreement(config, {
		option: "Next's basePath",
		base: nextConfig.basePath ?? "",
	});
	if (problem !== undefined) {
		throw new GraiError(
			"config-invalid",
			{ file: basename(configFile) },
			problem,
		);
	}
}

function built(result: CompileResult): void {
	if (result.errors.length === 0) return;
	reportErrors(result.errors);
	throw new Error(
		`grai: the catalogs did not compile, with ${count(result.errors)}.`,
	);
}

/** The config, with the output's name resolved to the outdir by Turbopack and by webpack. */
function resolvingOutput(nextConfig: NextConfig, outdir: string): NextConfig {
	const { turbopack, webpack } = nextConfig;
	return {
		...nextConfig,
		turbopack: {
			...turbopack,
			resolveAlias: {
				...turbopack?.resolveAlias,
				[`${output}/*`]: `./${relative(process.cwd(), outdir)}/*`,
			},
		},
		webpack(config, context) {
			const resolved = webpack ? webpack(config, context) : config;
			resolved.resolve.alias[output] = outdir;
			return resolved;
		},
	};
}
