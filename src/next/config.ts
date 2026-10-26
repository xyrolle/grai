import { basename, relative, resolve } from "node:path";
import type { NextConfig } from "next";
import {
	PHASE_DEVELOPMENT_SERVER,
	PHASE_PRODUCTION_BUILD,
} from "next/constants.js";
import { baseDisagreement } from "../base-agreement.ts";
import { type CompileResult, compile, isCompiled } from "../compile.ts";
import { type Config, readConfig } from "../config.ts";
import { GraiError } from "../error.ts";
import { watch } from "../watch.ts";

/** The name grai/next imports the project's compiled output by, in every layer Next bundles. */
const output = "grai/next/output";

/** What withGrai takes besides Next's config: the grai config's file, grai.config.json by default. */
export type WithGraiOptions = { config?: string };

/**
 * Wraps a Next config for grai, with grai.config.json in the project's directory, or the file
 * `options.config` names. `next dev` compiles the catalogs and recompiles on each change; `next
 * build` compiles them and fails on any error. Both bundlers then resolve grai/next's imports of
 * the output to the config's outdir. Any other command bundles nothing, and gets the config as it
 * is. A Next `basePath` other than grai's is refused under the `url` strategy.
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
		if (dev) await watching(configFile);
		else built(await compile(configFile));
		return resolvingOutput(nextConfig, outdir);
	};
}

/** The watch of this process: Next asks for its config more than once, and it starts once. */
let watched: Promise<void> | undefined;

function watching(configFile: string): Promise<void> {
	watched ??= startWatching(configFile);
	return watched;
}

/**
 * Watches, and settles once the output can be read: at once when it is current, so that Next
 * starts while the watch's first compile builds what each edit after it starts from, and else
 * once that compile has written it. Either way the catalogs compile once. The check comes first:
 * started beside it, the watch's compile would hold it back.
 */
async function startWatching(configFile: string): Promise<void> {
	const compiled = await isCompiled(configFile);
	const firstCompile = new Promise<void>((settled) => {
		watch(
			configFile,
			(result) => {
				reportErrors(result.errors);
				settled();
			},
			// A compile that throws, as when the outdir cannot be written: the next save compiles again.
			(error) => {
				console.error(error);
				settled();
			},
			// Next's server holds its process. Other processes read the config for `next dev` too, as
			// Next's telemetry flush does when the server stops, and must be free to exit.
			{ persistent: false },
		);
	});
	if (!compiled) await firstCompile;
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

function reportErrors(errors: readonly GraiError[]): void {
	if (errors.length === 0) return;
	for (const error of errors) console.error(error.message);
	console.error(`grai: ${count(errors)}`);
}

function count(errors: readonly GraiError[]): string {
	return `${errors.length} ${errors.length === 1 ? "error" : "errors"}`;
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
