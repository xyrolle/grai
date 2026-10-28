import { type FSWatcher, watch as watchPath } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type { Build, CompiledProject, CompileResult } from "./compile.ts";
import { isMissing, readConfig } from "./config.ts";
import { GraiError } from "./error.ts";
import { firstBuildSaver } from "./first-build-saver.ts";
import { whenQuiet } from "./quiet.ts";
import { savedBuild, savedIndex } from "./saved-build.ts";
import type { Served, ServedIndex } from "./served.ts";

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
 * The compiler, loaded once a watcher first compiles or writes: a restart serves its first page
 * from the saved build's index (`savedIndex`), and loads it only as it takes the build up.
 */
const compiler = () => import("./compile.ts");

/** How a watcher compiles: for development, with the config's pseudo-locale. */
export const developing = { pseudoLocale: true };

/**
 * How long what follows a first page served early may wait for the process to be quiet: long
 * enough for the page's own requests, which take a fraction of a second, so that it never runs in
 * their way; short enough that a server kept busy still shows an error only the write finds, and
 * writes the types, seconds after it starts.
 */
const followDeadline = 2000;

/**
 * Compiles for development, with the config's pseudo-locale if it names one, then compiles again
 * whenever the config or a catalog changes, or `compileAgain` is called, and nothing else.
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
 * `first` settles once the first compile has ended, and `compileAgain` once a compile it starts,
 * or the one after the compile under way, has: with how it ended, after its report, and after the
 * read again a catalog in the middle of a save takes, so a caller that waits for it never sees
 * output that compile is still to write.
 *
 * The first compile starts from the build the project's last watcher saved, if this grai saved it
 * on this runtime from the same config (`savedBuild`), so a start compiles only what changed since,
 * as an edit does. With `serve`, a dev server's first page is served before that: from the saved
 * build's index (`savedIndex`), while the catalogs are as they were, the output being that build's;
 * else, with no saved build to start from, from the first compile, before its output is written
 * (`compileProject`). What is served goes to `serve`, with whether its output is written, and is
 * neither reported nor ended. One task then follows: it takes up the saved build, or writes what
 * the first compile served, its keys declared now; once the process is quiet (`whenQuiet`), or by
 * `followDeadline`, on the next change, when `write` asks for it, or as the watcher closes. A write
 * is reported, closing or not, and ends the compile; a change since what was served is compiled
 * after it. Every other compile is reported once its output is written. Its first build written is
 * saved for the next start (`firstBuildSaver`), or the build of a compile `compileAgain` asked for,
 * which placed the keys anew. It watches until the process ends or `close` is called, whose promise
 * settles once the compile under way, if any, has finished, the output is written and the build is
 * saved, so the project can then be removed.
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
	}: {
		serve?: (served: Served, milliseconds: number, written: boolean) => void;
	} = {},
): Watch {
	let closed = false;
	let watchers: FSWatcher[] = [];
	/** The last build written, which the next compile starts from. */
	let build: Build | undefined;
	/**
	 * What the first page was served from early, until the task that follows it has ended, which
	 * every caller of `write` and `close` waits for: the first compile, served before its output was
	 * written, which the task writes (`writeServed`); or the saved build's index, which the task
	 * takes the build up after.
	 */
	let early:
		| (({ compiled: CompiledProject } | { index: ServedIndex }) & {
				followed: PromiseWithResolvers<void>;
		  })
		| undefined;
	/** Whether the task that follows what was served early is under way. */
	let following = false;
	/** Whether the first page is served before the first compile has its build: with `serve`. */
	let servesEarly = serve !== undefined;
	/** The wait for the process to be quiet, to run the task that follows what was served early. */
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
	const saver = firstBuildSaver();
	/** How many compiles have begun, and those waiting for a compile begun after a count to end. */
	let begun = 0;
	let waiting: { after: number; ended: (compiled: Compiled) => void }[] = [];
	/** Ends the wait of every caller a compile begun since its call was waiting for. */
	const ended = (compiled: Compiled) => {
		const done = waiting.filter(({ after }) => after < begun);
		waiting = waiting.filter(({ after }) => after >= begun);
		for (const waiter of done) waiter.ended(compiled);
	};
	/** How the next compile begun from now ends. */
	const nextCompile = () =>
		new Promise<Compiled>((resolve) => {
			if (closed) resolve({ closed: true });
			else waiting.push({ after: begun, ended: resolve });
		});

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
	 * Writes what the first compile served: as a compile from itself, as no key changed since it was
	 * served, its keys declared now (`writeBuild`). Its result is reported even as the watcher
	 * closes, so an error only the write finds always reaches the server.
	 */
	const writeServed = async (compiled: CompiledProject, started: number) => {
		const unchanged = { ...compiled.compilation, changed: new Set<string>() };
		const { writeBuild } = await compiler();
		const next = await writeBuild(
			{ ...compiled, compilation: unchanged },
			undefined,
			developing,
		);
		if (next.build !== undefined) {
			saver.took(next.build, build);
			build = next.build;
		}
		const milliseconds = performance.now() - started;
		report(next.result, milliseconds, next.build);
		reportedBuild = next.build !== undefined;
		return { result: next.result, milliseconds, build: next.build };
	};

	/** Serves the first page early, and has the task that follows it wait for quiet. */
	const serveEarly = (
		served: { compiled: CompiledProject } | { index: ServedIndex },
		started: number,
	) => {
		early = { ...served, followed: Promise.withResolvers() };
		stopWaiting = whenQuiet(run, { deadline: followDeadline });
		const page = "index" in served ? served.index : served.compiled;
		if (!closed) serve?.(page, performance.now() - started, "index" in served);
	};

	/**
	 * Compiles what changed since the last compile and writes its output, or, for the first compile
	 * when it serves early, returns what it compiled unwritten. The first build written is saved
	 * (`firstBuildSaver`).
	 */
	const compileOnce = async (): Promise<
		{ result: CompileResult; build?: Build } | { served: CompiledProject }
	> => {
		changes = false;
		const serving = servesEarly && !closed;
		const { compileProject, writeBuild } = await compiler();
		// A compile served before its write leaves the keys' declarations to the write too.
		const compiled = await compileProject(configFile, build, {
			...developing,
			declare: !serving,
		});
		if ("errors" in compiled)
			return { result: { written: [], errors: compiled.errors } };
		if (serving) return { served: compiled };
		const next = await writeBuild(compiled, build, developing);
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
			begun += 1;
			const started = performance.now();
			const served = early;
			try {
				follow();
				if (first) {
					first = false;
					const index =
						servesEarly && !closed
							? await savedIndex(configFile, developing)
							: undefined;
					if (index !== undefined) {
						servesEarly = false;
						serveEarly({ index }, started);
						continue;
					}
					build = await savedBuild(configFile, developing);
					servesEarly &&= build === undefined;
				}
				if (served !== undefined) {
					following = true;
					stopWaiting();
					if ("compiled" in served) {
						const written = await writeServed(served.compiled, started);
						if (!changes) {
							ended(written);
							continue;
						}
					} else {
						// The output is the saved build's: closing with no change, there is nothing to write.
						if (closed && !changes) continue;
						build = await savedBuild(configFile, developing);
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
				servesEarly = false;
				const milliseconds = performance.now() - started;
				// A compile served before its write ends with the compile that writes it.
				if ("served" in next) {
					serveEarly({ compiled: next.served }, started);
					reportedBuild = false;
					continue;
				}
				if (!closed && !(reportedBuild && unchanged(next))) {
					report(next.result, milliseconds, next.build);
					reportedBuild = next.build !== undefined;
				}
				ended({ result: next.result, milliseconds, build: next.build });
			} catch (error) {
				reportedBuild = false;
				failed(error);
				ended({ error });
			} finally {
				if (served !== undefined) {
					early = undefined;
					following = false;
					served.followed.resolve();
				}
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

	const firstCompile = nextCompile();
	run();
	return {
		first: firstCompile,
		compileAgain: async () => {
			const compiled = nextCompile();
			changes = true;
			if (!closed) run();
			const again = await compiled;
			if ("build" in again && again.build !== undefined)
				saver.retook(again.build);
			return again;
		},
		write: async () => {
			if (early === undefined) return false;
			const { followed } = early;
			if (!following) {
				stopWaiting();
				run();
			}
			await followed.promise;
			return true;
		},
		close: async () => {
			closed = true;
			clearTimeout(settling);
			stopWaiting();
			for (const watcher of watchers) watcher.close();
			await running;
			// The first compile's output is written before the watcher closes, as its build is saved.
			if (early !== undefined) {
				run();
				await running;
			}
			for (const waiter of waiting) waiter.ended({ closed: true });
			waiting = [];
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
	 * Compiles again, for an input no followed file changes, such as the groups an adapter saved,
	 * and settles with how that compile ends.
	 */
	compileAgain: () => Promise<Compiled>;
	/**
	 * Runs the task that follows a first page served early (`serve`) now, if it has not run: the
	 * write of the first compile, or the take-up of the saved build after its index, which writes
	 * any file of the output gone since. Settles once it has ended, written or failed, with whether
	 * there was one.
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
