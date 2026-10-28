import { mappingFile } from "../import/mapping-file.ts";

/**
 * The CLI's commands, each by its name, in the order the usage lists them: its lines of the usage,
 * and its module, loaded only when the command runs, so that a command loads its own code and no
 * other command's. The usage stays here so that printing it loads none of them.
 */
export type CommandEntry = {
	usage: string;
	load: () => Promise<{ run: (args: string[]) => Promise<number> }>;
};

export const commands: Record<string, CommandEntry> = {
	compile: {
		usage:
			"  compile                      write the output, if the catalogs or config changed",
		load: () => import("./compile.ts"),
	},
	watch: {
		usage:
			"  watch                        write it, then again on each change of a catalog or the config",
		load: () => import("./watch.ts"),
	},
	check: {
		usage: `  check [--source <dir>]... [--json]
                               report every problem and write nothing: what compile reports,
                               keys no shipped source names, inputs the locales do not agree on;
                               and the keys each locale has not translated yet
  check --fix [--source <dir>]...
                               remove the keys no shipped source can name from every catalog,
                               import each key from its own path where an import takes it from
                               keys.js, then check`,
		load: () => import("./check.ts"),
	},
	seed: {
		usage: `  seed <locale>                give the locale's catalog the base text of each key it lacks,
                               creating it if need be, then compile`,
		load: () => import("./seed.ts"),
	},
	export: {
		usage: `  export <locale> [--untranslated] [--json]
                               print the locale's messages for translators, as XLIFF 2.0, or
                               as JSON for scripts: every key, or the untranslated ones`,
		load: () => import("./export.ts"),
	},
	merge: {
		usage: `  merge <file>                 write the translations of an exported file into its
                               locale's catalog, refusing each stale or invalid one, then compile`,
		load: () => import("./merge.ts"),
	},
	add: {
		usage: `  add <key> --<locale> <text>  with a text for each locale that lacks the key: add it to
                               every catalog that lacks it, then compile`,
		load: () => import("./add.ts"),
	},
	import: {
		usage: `  import --from i18next|icu <file or dir>...
                               convert another library's catalogs into new grai catalogs, and
                               report each message left out or rendered differently`,
		load: () => import("./import.ts"),
	},
	migrate: {
		usage: `  migrate [--source <dir>]... [--default-namespace <ns>]
                               rewrite each call of the imported library that names its message
                               plainly as a call of the grai message ${mappingFile} maps it to,
                               and report every other call, for a person to migrate`,
		load: () => import("./migrate.ts"),
	},
	find: {
		usage: `  find <key> [--source <dir>]...
                               print the key's line in each catalog, and each call site`,
		load: () => import("./find.ts"),
	},
	rename: {
		usage: `  rename <key> <new> [--source <dir>]...
                               rename the key in every catalog and at every call site, then
                               compile; nothing changes if a call site is unclear`,
		load: () => import("./rename.ts"),
	},
};
