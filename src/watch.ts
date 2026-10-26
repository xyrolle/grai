import { type FSWatcher, watch as watchPath } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { type Build, type CompileResult, recompile } from "./compile.ts";
import { isMissing, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import { firstBuildSaver } from "./first-build-saver.ts";
import { savedBuild } from "./saved-build.ts";

/**
 * How long the followed files must be quiet before a catalog that did not parse is read again. A
 * save that truncates a file and then writes it can come as several events, and a read between
 * them sees part of the file, which never parses: a part of a JSON object is not one. Saving a
 * 689 KB catalog from another process on macOS, by `writeFile` or in 16 KB writes, gave events
 * at most 5.4 ms apart, and writing went on for at most 2.5 ms after the last one: 20 ms covers
 * both with room, and a broken catalog is still reported 20 ms after its save.
 */
const settleMilliseconds = 20;

/**
 * How a watch holds its process. A persistent watch, the default, keeps the process running while
 * it watches, as `grai watch` needs; `persistent: false` leaves the process's lifetime to a host
 * that holds it, such as a dev server, so that a process that only reads the config can exit.
 */
export type WatchOptions = { persistent?: boolean };

/**
 * Compiles for development, with the config's pseudo-locale if it names one, then compiles again
 * whenever the config or a catalog changes, and nothing else.
 * Each compile after the first builds on the last one that succeeded, so it redoes only what
 * changed. A change is compiled on its first event. A compile that finds a catalog that does not
 * parse, as a read in the middle of a save does, is not reported: the files are read again once
 * they have been quiet for `settleMilliseconds`, and that compile's result stands. A compile reads
 * after an event, so it sees at least the save's first write, and part of a JSON object never
 * parses: a read that parses sees a catalog whole, before a save starts or after it ends. A compile
 * that changed nothing since the last one reported, as one that an event late from a save already
 * read starts, is not reported either. Changes that come during a compile are taken together by
 * the next one. Each result is reported with
 * how long the compile took, and with its build when it succeeded; a compile that throws, as when
 * the outdir cannot be written, goes to `failed`, and the next change compiles again.
 *
 * The first compile starts from the build the project's last watcher saved, if this grai saved it
 * on this runtime from the same config (`savedBuild`), so a start compiles only what changed since,
 * as an edit does. Its first build is saved for the next start (`firstBuildSaver`). It watches until the process ends or `close` is called, whose promise settles once the
 * compile under way, if any, has finished and the build is saved, so the project can then be
 * removed.
 */
export function watch(
	configFile: string,
	report: (
		result: CompileResult,
		milliseconds: number,
		build: Build | undefined,
	) => void,
	failed: (error: unknown) => void,
	{ persistent = true }: WatchOptions = {},
): { close: () => Promise<void> } {
	let closed = false;
	let watchers: FSWatcher[] = [];
	let build: Build | undefined;
	let running: Promise<void> | undefined;
	let again = false;
	/** The wait for the files to be quiet, after a catalog that did not parse. */
	let settling: ReturnType<typeof setTimeout> | undefined;
	/** Whether the next compile reads files that have been quiet, so its result stands. */
	let settled = false;
	/**
	 * Whether the last compile reported built the output, so a compile after it that changes nothing
	 * has nothing to tell. A compile that throws clears it, so the next one is reported.
	 */
	let reportedBuild = false;
	/** Whether the next compile is the first, which starts from the saved build. */
	let first = true;
	const saver = firstBuildSaver();

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
			(path) => watchedFile(path, changed, persistent) ?? [],
		);
	};

	/** A file's event: a compile now, or, while the files are settling, a longer wait for them. */
	const changed = () => {
		if (settling === undefined) {
			run();
			return;
		}
		clearTimeout(settling);
		settling = settleLater();
	};
	/** The wait for the files to be quiet, which holds the process only when the watch does. */
	const settleLater = () => {
		const timer = setTimeout(settle, settleMilliseconds);
		if (!persistent) timer.unref();
		return timer;
	};
	const settle = () => {
		settling = undefined;
		settled = true;
		run();
	};

	/** Compiles until no change came during the last compile, or until closed. */
	const compileChanges = async () => {
		do {
			again = false;
			const quiet = settled;
			settled = false;
			const started = performance.now();
			try {
				follow();
				if (first) {
					first = false;
					build = await savedBuild(configFile, { pseudoLocale: true });
				}
				const next = await recompile(configFile, build, {
					pseudoLocale: true,
				});
				if (!quiet && unparsed(next.result)) {
					again = false;
					settling = settleLater();
					return;
				}
				build = next.build ?? build;
				if (next.build !== undefined) saver.took(next.build);
				if (closed || (reportedBuild && unchanged(next))) continue;
				report(next.result, performance.now() - started, next.build);
				reportedBuild = next.build !== undefined;
			} catch (error) {
				reportedBuild = false;
				failed(error);
			}
		} while (again && !closed);
	};

	const run = () => {
		if (running !== undefined) {
			again = true;
			return;
		}
		running = compileChanges().finally(() => {
			running = undefined;
		});
	};

	run();
	return {
		close: async () => {
			closed = true;
			clearTimeout(settling);
			for (const watcher of watchers) watcher.close();
			await running;
			await saver.flush();
		},
	};
}

/** Whether a compile succeeded without changing a key or writing a file. */
function unchanged(next: { result: CompileResult; build?: Build }): boolean {
	return (
		next.build !== undefined &&
		next.result.written.length === 0 &&
		next.build.compilation.changed.size === 0
	);
}

/** Whether a compile found a catalog that does not parse, as a read in the middle of a save does. */
function unparsed(result: CompileResult): boolean {
	return result.errors.some((error) => error.code === "catalog-invalid");
}

/**
 * Watches a file for changes. A file that does not exist yet is watched for through its directory,
 * and one whose directory does not exist either is not watched: its catalog is missing, which the
 * compile reports.
 */
function watchedFile(
	path: string,
	changed: () => void,
	persistent: boolean,
): FSWatcher | undefined {
	try {
		return watchPath(path, { persistent }, () => changed());
	} catch (error) {
		if (!isMissing(error)) throw error;
	}
	try {
		return watchPath(dirname(path), { persistent }, (_event, name) => {
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
		return [...readConfig(configFile).catalogs.values()].flat();
	} catch (error) {
		if (error instanceof GraiError) return [];
		throw error;
	}
}
