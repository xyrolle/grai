import type { Rolldown } from "vite";

/** An output's code splitting where it splits code: on, by default, or with options. */
export type Splitting = Exclude<Rolldown.OutputOptions["codeSplitting"], false>;

/**
 * An output's code splitting with grai's `groups` after the app's own, which come first. grai adds
 * its groups to each output as Vite has resolved it, not through the config, where Vite would add
 * them as an output of their own to an app's list of outputs, and would make an output split code
 * that the app or Vite itself chose not to split: an IIFE, a library's, a worker's single entry.
 */
export function withGroups(
	splitting: Splitting,
	groups: readonly Rolldown.CodeSplittingGroup[],
): Rolldown.CodeSplittingOptions {
	const options = typeof splitting === "object" ? splitting : {};
	return { ...options, groups: [...(options.groups ?? []), ...groups] };
}
