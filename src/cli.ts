#!/usr/bin/env node
import { addCommand } from "./cli/add.ts";
import { checkCommand } from "./cli/check.ts";
import { type Command, UsageError } from "./cli/command.ts";
import { compileCommand } from "./cli/compile.ts";
import { exportCommand } from "./cli/export.ts";
import { findCommand } from "./cli/find.ts";
import { importCommand } from "./cli/import.ts";
import { mergeCommand } from "./cli/merge.ts";
import { renameCommand } from "./cli/rename.ts";
import { seedCommand } from "./cli/seed.ts";
import { watchCommand } from "./cli/watch.ts";

/** Each command by its name, in the order the usage lists them. */
const commands: Record<string, Command> = {
	compile: compileCommand,
	watch: watchCommand,
	check: checkCommand,
	seed: seedCommand,
	export: exportCommand,
	merge: mergeCommand,
	add: addCommand,
	import: importCommand,
	find: findCommand,
	rename: renameCommand,
};

const usage = `Usage: grai <command> [--config <file>]

${Object.values(commands)
	.map((command) => command.usage)
	.join("\n")}

The config is grai.config.json in the current directory, unless --config names another file.`;

const [name = "", ...args] = process.argv.slice(2);
const command = commands[name];
if (name === "--help" || name === "help") {
	console.log(usage);
} else if (command === undefined) {
	console.error(
		name === "" ? usage : `grai: there is no command "${name}"\n\n${usage}`,
	);
	process.exitCode = 2;
} else {
	try {
		process.exitCode = await command.run(args);
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		console.error(`grai: ${error.message}\n\n${usage}`);
		process.exitCode = 2;
	}
}
