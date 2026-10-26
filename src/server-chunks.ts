import type { Rolldown } from "vite";
import { isMessageModule } from "./locale-chunks.ts";
import { messageDirectory } from "./message-directories.ts";

/** An output's code splitting where it splits code: on, by default, or with options. */
type Splitting = Exclude<Rolldown.OutputOptions["codeSplitting"], false>;

/** The keys that two or more entries use, in one chunk. */
const sharedKeys = {
	name: messageDirectory,
	test: isMessageModule,
	minShareCount: 2,
};

/**
 * A server output's code splitting with the keys that two or more entries use in one chunk, and
 * each other key left in its entry's chunk. A server loads each chunk as a module of its own, and
 * by default each set of entries that shares keys gets a chunk, so a key that a few pages use is a
 * module alone: hundreds of them in a real app. The app's own groups come first.
 */
export function withSharedKeys(
	splitting: Splitting,
): Rolldown.CodeSplittingOptions {
	const options = typeof splitting === "object" ? splitting : {};
	return { ...options, groups: [...(options.groups ?? []), sharedKeys] };
}
