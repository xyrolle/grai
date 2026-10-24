import { type FSWatcher, watch as watchPath } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { type Build, type CompileResult, recompile } from "./compile.ts";
import { isMissing, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";

/**
 * Compiles, then compiles again whenever the config or a catalog changes, and nothing else.
 * Each compile after the first builds on the last one that succeeded, so it redoes only what
 * changed. Changes that come during a compile are taken together by the next one. Each result
 * is reported with how long the compile took, and with its build when it succeeded. It watches
 * until the process ends or `close` is called.
 */
export function watch(
	configFile: string,
	report: (
		result: CompileResult,
		milliseconds: number,
		build: Build | undefined,
	) => void,
): { close: () => void } {
	let closed = false;
	let watchers: FSWatcher[] = [];
	let build: Build | undefined;
	let compiling = false;
	let again = false;

	/**
	 * Watches the config and the catalogs it names, afresh before each compile: a file an editor
	 * saved by renaming another over it is a new file, and a change during the compile is seen.
	 */
	const follow = () => {
		for (const watcher of watchers) watcher.close();
		if (closed) {
			watchers = [];
			return;
		}
		const paths = [resolve(configFile), ...catalogsOf(configFile)];
		watchers = paths.flatMap(
			(path) => watchedFile(path, () => void run()) ?? [],
		);
	};

	const run = async () => {
		if (compiling) {
			again = true;
			return;
		}
		compiling = true;
		do {
			again = false;
			follow();
			const started = performance.now();
			const next = await recompile(configFile, build);
			build = next.build ?? build;
			if (!closed) report(next.result, performance.now() - started, next.build);
		} while (again && !closed);
		compiling = false;
	};

	void run();
	return {
		close: () => {
			closed = true;
			for (const watcher of watchers) watcher.close();
		},
	};
}

/**
 * Watches a file for changes. A file that does not exist yet is watched for through its directory,
 * and one whose directory does not exist either is not watched: its catalog is missing, which the
 * compile reports.
 */
function watchedFile(path: string, changed: () => void): FSWatcher | undefined {
	try {
		return watchPath(path, () => changed());
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
	try {
		return watchPath(dirname(path), (_event, name) => {
			if (name === null || name === basename(path)) changed();
		});
	} catch (error) {
		if (isMissing(error)) return undefined;
		throw error;
	}
}

/** The catalog files the config names, or none while the config cannot be read: the compile says why. */
function catalogsOf(configFile: string): string[] {
	try {
		return [...readConfig(configFile).catalogs.values()];
	} catch (error) {
		if (error instanceof GraiError) return [];
		throw error;
	}
}
