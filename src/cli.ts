#!/usr/bin/env node
import { addCommand } from "./commands/add.ts";
import { type Command, UsageError } from "./commands/arguments.ts";
import { checkCommand } from "./commands/check.ts";
import { compileCommand } from "./commands/compile.ts";
import { findCommand } from "./commands/find.ts";
import { importCommand } from "./commands/import.ts";
import { renameCommand } from "./commands/rename.ts";
import { seedCommand } from "./commands/seed.ts";
import { watchCommand } from "./commands/watch.ts";

/** The commands by name, in the order the usage lists them. Each is wired in its module of commands/. */
const commands: Record<string, Command> = {
	compile: compileCommand,
	watch: watchCommand,
	check: checkCommand,
	seed: seedCommand,
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
