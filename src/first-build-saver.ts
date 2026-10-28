import type { Build } from "./compile.ts";
import { whenQuiet } from "./quiet.ts";
import { saveBuild, saveBuildNow } from "./saved-build.ts";

/**
 * Saves a watcher's first build once the process is quiet (`whenQuiet`), once `flush` is called,
 * or as the process exits, unless it is the build it started from (`from`) as that was saved: it
 * compiled no key, and placed the keys as that did (`rendered.groups`). One that placed them by
 * groups saved since is saved, so the next start does not place them again. The builds after it are
 * not saved, since the next start compiles what they changed as edits. Saving the build of a
 * project of 6,379 keys in 3 locales takes about 20 ms to serialize 22 MB, which its dev server's
 * start, about 5 s of work, should not take on. The save at exit is for a process that ends before
 * it is quiet: a dev server stopped by SIGTERM, which Vite closes, though in an app whose own
 * SIGTERM handler exits at once it never closes.
 */
export function firstBuildSaver(): {
	took: (build: Build, from: Build | undefined) => void;
	flush: () => Promise<void>;
} {
	let taken = false;
	let unsaved: Build | undefined;
	let stopWaiting = () => {};
	let saving: Promise<void> | undefined;
	// A build that cannot be saved, as when the outdir was removed, costs only the next start its compile.
	const save = () => {
		stopWaiting();
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
			unsaved = build;
			stopWaiting = whenQuiet(save);
			process.once("exit", saveNow);
		},
		flush: async () => {
			save();
			await saving;
		},
	};
}
