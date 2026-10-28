import { performance } from "node:perf_hooks";
import type { Build } from "./compile.ts";
import { saveBuild, saveBuildNow } from "./saved-build.ts";

/**
 * When the process is quiet: a window of `quietMilliseconds` in which its event loop worked less
 * than `quietShare` of the time. A dev server keeps its loop busy while it starts and while it
 * answers a page's requests, and hardly at all while it waits for an edit. Saving the build of a
 * project of 6,379 keys in 3 locales takes about 20 ms to serialize 22 MB, which its dev server's
 * start, about 5 s of work, should not take on.
 */
const quietMilliseconds = 500;
const quietShare = 0.1;

/**
 * Saves a watcher's first build once the process is quiet, once `flush` is called, or as the
 * process exits, unless it is the build it started from (`from`) as that was saved: it compiled no
 * key, and placed the keys as that did (`rendered.groups`). One that placed them by groups saved
 * since is saved, so the next start does not place them again. The builds after
 * it are not saved, since the next start compiles what they changed as edits. The save at exit is
 * for a process that ends before it is quiet: a dev server stopped by SIGTERM, which Vite closes,
 * though in an app whose own SIGTERM handler exits at once it never closes.
 */
export function firstBuildSaver(): {
	took: (build: Build, from: Build | undefined) => void;
	flush: () => Promise<void>;
} {
	let taken = false;
	let unsaved: Build | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let saving: Promise<void> | undefined;
	// A build that cannot be saved, as when the outdir was removed, costs only the next start its compile.
	const save = () => {
		clearInterval(timer);
		timer = undefined;
		process.off("exit", saveNow);
		if (unsaved !== undefined) saving = saveBuild(unsaved).catch(() => {});
		unsaved = undefined;
	};
	const saveNow = () => {
		if (unsaved === undefined) return;
		try {
			saveBuildNow(unsaved);
		} catch {}
	};
	/** Saves this build once the process is quiet, in place of any not saved yet. */
	const keep = (build: Build) => {
		unsaved = build;
		if (timer !== undefined) return;
		let since = performance.eventLoopUtilization();
		timer = setInterval(() => {
			const window = performance.eventLoopUtilization(since);
			since = performance.eventLoopUtilization();
			if (window.utilization < quietShare) save();
		}, quietMilliseconds);
		timer.unref();
		process.once("exit", saveNow);
	};
	return {
		took: (build, from) => {
			if (taken) return;
			taken = true;
			// The build it started from, unchanged: its keys and their places are those it saved.
			if (
				build.compilation.changed.size === 0 &&
				build.rendered.groups === from?.rendered.groups
			)
				return;
			keep(build);
		},
		flush: async () => {
			save();
			await saving;
		},
	};
}
