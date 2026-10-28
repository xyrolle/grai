import type { Build } from "./compile.ts";
import { whenQuiet } from "./quiet.ts";
import { saveBuild, saveBuildNow } from "./saved-build.ts";

/**
 * Saves the build a watcher's start ends with once the process is quiet (`whenQuiet`), once `flush`
 * is called, or as the process exits: the last build its first compile and the compiles of the
 * changes that came meanwhile wrote, until `started` is called, or, if they wrote none, the first
 * build written after. None is saved if every build of the start is the build it started from
 * (`from`), as that was saved: it compiled no key, and placed the keys as that did
 * (`rendered.groups`). One that placed them by groups saved since is saved, so the next start does
 * not place them again. The builds after it are not saved, since the next start compiles what they
 * changed as edits. Saving the
 * build of a project of 6,379 keys in 3 locales takes about 20 ms to serialize 22 MB, which its dev
 * server's start, about 5 s of work, should not take on. The save at exit is for a process that
 * ends before it is quiet: a dev server stopped by SIGTERM, which Vite closes, though in an app
 * whose own SIGTERM handler exits at once it never closes.
 */
export function firstBuildSaver(): {
	took: (build: Build, from: Build | undefined) => void;
	started: () => void;
	flush: () => Promise<void>;
} {
	let starting = true;
	/** Whether a build was taken, and whether one taken differs from the one before it. */
	let taken = false;
	let differs = false;
	let unsaved: Build | undefined;
	/** Stops the wait for the process to be quiet, while one runs. */
	let stopWaiting: (() => void) | undefined;
	let saving: Promise<void> | undefined;
	// A build that cannot be saved, as when the outdir was removed, costs only the next start its compile.
	const save = () => {
		stopWaiting?.();
		stopWaiting = undefined;
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
		if (stopWaiting !== undefined) return;
		stopWaiting = whenQuiet(save);
		process.once("exit", saveNow);
	};
	return {
		took: (build, from) => {
			if (taken && !starting) return;
			taken = true;
			// A build that compiled no key from the build before it, and placed the keys as that did,
			// holds what that one does.
			differs ||=
				build.compilation.changed.size > 0 ||
				build.rendered.groups !== from?.rendered.groups;
			if (differs) keep(build);
		},
		started: () => {
			starting = false;
		},
		flush: async () => {
			save();
			await saving;
		},
	};
}
