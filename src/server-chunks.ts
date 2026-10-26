import type { Rolldown } from "vite";
import { isMessageModule } from "./locale-chunks.ts";
import { messageDirectory } from "./message-directories.ts";

/**
 * A server build's group of messages: the keys that two or more entries use in one chunk, and each
 * other key left in its entry's chunk. A server loads each chunk as a module of its own, and by
 * default each set of entries that shares keys gets a chunk, so a key that a few pages use is a
 * module alone: hundreds of them in a real app.
 */
export const sharedKeys: Rolldown.CodeSplittingGroup = {
	name: messageDirectory,
	test: isMessageModule,
	minShareCount: 2,
};
