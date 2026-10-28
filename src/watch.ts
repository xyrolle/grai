import { type FSWatcher, watch as watchPath } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import {
	type Build,
	type CompiledProject,
	type CompileResult,
	compileProject,
	writeBuild,
} from "./compile.ts";
import { isMissing, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import { firstBuildSaver } from "./first-build-saver.ts";
import type { Placing } from "./placing.ts";
import { whenQuiet } from "./quiet.ts";
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

/** How a watcher compiles: for development, with the config's pseudo-locale. */
export const developing = { pseudoLocale: true };

/**
 * How long the write of a first compile served before it may wait for the process to be quiet:
 * long enough for a first page's own requests, which take a fraction of a second, so that the
 * write never runs in their way; short enough that a server kept busy still shows an error only the
 * write finds, and writes the types, seconds after it starts.
 */
const writeDeadline = 2000;

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
 * `first` settles once the watch has started: its first compile has ended, after its report and
 * after the read again a catalog in the middle of a save takes, and so has every compile of a change
 * that came meanwhile, and of one that came during those, so a caller that waits for it never sees
 * output the start is still to write. It settles with how the last of them ended. The first compile
 * that writes, and none after it, asks `placeFirst` for the groups to place the keys by
 * (`placing.ts`), as Next's watch does with the groups it reads beside it.
 *
 * The first compile starts from the build the project's last watcher saved, if this grai saved it
 * on this runtime from the same config (`savedBuild`), so a start compiles only what changed since,
 * as an edit does. With `serve`, a first compile with no saved build to start from goes to `serve`
 * before its output is written (`compileProject`), as a dev server serves its first page from it,
 * and is neither reported nor ended. One task then writes what it served, its keys declared now:
 * once the process is quiet (`whenQuiet`), or by `writeDeadline`, on the next change, when `write`
 * asks for it, or as the watcher closes. Its result is reported, closing or not, and ends the
 * compile; a change since the first compile is compiled after it. Every other compile is reported
 * once its output is written. The build the start ends with is saved for the next start
 * (`firstBuildSaver`). It watches until the process ends or `close` is called, whose promise settles once the
 * compile under way, if any, has finished, the output is written and the build is saved, so the
 * project can then be removed.
 */
export function watch(
	configFile: string,
	report: (
		result: CompileResult,
		milliseconds: number,
		build: Build | undefined,
	) => void,
	failed: (error: unknown) => void,
	{
		serve,
		placeFirst,
	}: {
		serve?: (compiled: CompiledProject, milliseconds: number) => void;
		placeFirst?: Placing | undefined;
	} = {},
): Watch {
	let closed = false;
	let watchers: FSWatcher[] = [];
	/** The last build written, which the next compile starts from. */
	let build: Build | undefined;
	/**
	 * The first compile, served before its output was written, until its write (`writeServed`) has
	 * ended, which every caller of `write` and `close` waits for.
	 */
	let unwritten:
		| { compiled: CompiledProject; written: PromiseWithResolvers<void> }
		| undefined;
	/** Whether the write of what the first compile served is under way. */
	let writingServed = false;
	/** Whether the next compile is the first and defers its write: none if a saved build was taken up. */
	let defersWrite = serve !== undefined;
	/** The wait for the process to be quiet, to write the first compile's output. */
	let stopWaiting = () => {};
	/** Whether a followed file changed, or a compile was asked for, since the last compile read them. */
	let changes = false;
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
	/** Whether the watch is starting, until `first` settles; and how the last compile ended. */
	let starting = true;
	let last: Compiled | undefined;
	const start = Promise.withResolvers<Compiled>();
	const saver = firstBuildSaver();
	/** Ends the start, with how its last compile ended: no compile after it asks for groups. */
	const endStart = (compiled: Compiled) => {
		starting = false;
		placeFirst = undefined;
		saver.started();
		start.resolve(compiled);
	};
	/** The groups for this write to place the keys by: asked once, of the start's first write. */
	const placing = () => {
		const asked = placeFirst;
		placeFirst = undefined;
		return asked;
	};
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
		watchers = paths.flatMap((path) => watchedFile(path, changed) ?? []);
	};

	/** A file's event: a compile now, or, while the files are settling, a longer wait for them. */
	const changed = () => {
		changes = true;
		if (settling === undefined) {
			run();
			return;
		}
		clearTimeout(settling);
		settling = setTimeout(settle, settleMilliseconds);
	};
	const settle = () => {
		settling = undefined;
		settled = true;
		run();
	};

	/**
	 * Writes what the first compile served (`unwritten`): as a compile from itself, as no key
	 * changed since it was served, its keys declared now (`writeBuild`). Its result is reported even
	 * as the watcher closes, so an error only the write finds always reaches the server, and every
	 * caller waiting for it is answered.
	 */
	const writeServed = async (
		{ compiled, written }: NonNullable<typeof unwritten>,
		started: number,
	) => {
		writingServed = true;
		stopWaiting();
		try {
			const unchanged = { ...compiled.compilation, changed: new Set<string>() };
			const next = await writeBuild(
				{ ...compiled, compilation: unchanged },
				undefined,
				{ ...developing, placing: placing() },
			);
			if (next.build !== undefined) {
				saver.took(next.build, build);
				build = next.build;
			}
			const milliseconds = performance.now() - started;
			report(next.result, milliseconds, next.build);
			reportedBuild = next.build !== undefined;
			return { result: next.result, milliseconds, build: next.build };
		} finally {
			unwritten = undefined;
			writingServed = false;
			written.resolve();
		}
	};

	/**
	 * Compiles what changed since the last compile and writes its output, or, for the first compile
	 * when it defers its write, holds what it served unwritten, to write once the process is quiet
	 * or by `writeDeadline`. The first build written is saved (`firstBuildSaver`).
	 */
	const compileOnce = async (): Promise<
		{ result: CompileResult; build?: Build } | { served: CompiledProject }
	> => {
		changes = false;
		const deferring = defersWrite && !closed;
		// A compile served before its write leaves the keys' declarations to the write too.
		const compiled = await compileProject(configFile, build, {
			...developing,
			declare: !deferring,
		});
		if ("errors" in compiled)
			return { result: { written: [], errors: compiled.errors } };
		if (deferring) {
			unwritten = { compiled, written: Promise.withResolvers() };
			stopWaiting = whenQuiet(run, { deadline: writeDeadline });
			return { served: compiled };
		}
		const next = await writeBuild(compiled, build, {
			...developing,
			placing: placing(),
		});
		if (next.build === undefined) return next;
		saver.took(next.build, build);
		build = next.build;
		return next;
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
					build = await savedBuild(configFile, developing);
					defersWrite &&= build === undefined;
				}
				if (unwritten !== undefined) {
					const served = await writeServed(unwritten, started);
					if (!changes) {
						last = served;
						continue;
					}
				}
				const next = await compileOnce();
				if ("result" in next && !quiet && unparsed(next.result)) {
					again = false;
					// One wait for quiet at a time: a compile asked for while one went on reads again with it.
					clearTimeout(settling);
					settling = setTimeout(settle, settleMilliseconds);
					return;
				}
				defersWrite = false;
				const milliseconds = performance.now() - started;
				// A compile served before its write ends with the compile that writes it.
				if ("served" in next) {
					if (!closed) serve?.(next.served, milliseconds);
					reportedBuild = false;
					continue;
				}
				if (!closed && !(reportedBuild && unchanged(next))) {
					report(next.result, milliseconds, next.build);
					reportedBuild = next.build !== undefined;
				}
				last = { result: next.result, milliseconds, build: next.build };
			} catch (error) {
				reportedBuild = false;
				failed(error);
				last = { error };
			}
		} while (again && !closed);
		// The start ends with the last compile of the changes that came during it, written.
		if (starting && !closed && unwritten === undefined && last !== undefined)
			endStart(last);
	};

	const run = () => {
		if (running !== undefined) {
			again = true;
			return;
		}
		running = compileChanges().finally(() => {
			running = undefined;
			// A compile asked for after the last one checked for more, as the write a page's serve leads
			// to asks for at once, runs now.
			if (again && !closed) run();
		});
	};

	run();
	return {
		first: start.promise,
		write: async () => {
			if (unwritten === undefined) return false;
			const { written } = unwritten;
			if (!writingServed) {
				stopWaiting();
				run();
			}
			await written.promise;
			return true;
		},
		close: async () => {
			closed = true;
			clearTimeout(settling);
			stopWaiting();
			for (const watcher of watchers) watcher.close();
			await running;
			// The first compile's output is written before the watcher closes, as its build is saved.
			if (unwritten !== undefined) {
				run();
				await running;
			}
			if (starting) endStart(last ?? { closed: true });
			await saver.flush();
		},
	};
}

/**
 * How a compile ended: its result, how long it took, and its build when it succeeded; or what it
 * threw; or that the watch closed first.
 */
export type Compiled =
	| { result: CompileResult; milliseconds: number; build: Build | undefined }
	| { error: unknown }
	| { closed: true };

/** A watch under way. */
export type Watch = {
	/** How the first compile ends. */
	first: Promise<Compiled>;
	/**
	 * Writes what a first compile served before its write (`serve`) now, if it is not written yet,
	 * and settles once that write has ended, written or failed, with whether there was one.
	 */
	write: () => Promise<boolean>;
	close: () => Promise<void>;
};

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
		return [...readConfig(configFile).catalogs.values()].flat();
	} catch (error) {
		if (error instanceof GraiError) return [];
		throw error;
	}
}
