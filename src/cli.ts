#!/usr/bin/env node
import { UsageError } from "./cli/command.ts";
import { commands } from "./cli/commands.ts";
import { ownEntry } from "./own-entry.ts";

const usage = `Usage: grai <command> [--config <file>]

${Object.values(commands)
	.map((command) => command.usage)
	.join("\n")}

The config is grai.config.json in the current directory, unless --config names another file.`;

const [name = "", ...args] = process.argv.slice(2);
const command = ownEntry(commands, name);
if (name === "--help" || name === "help") {
	console.log(usage);
} else if (command === undefined) {
	console.error(
		name === "" ? usage : `grai: there is no command "${name}"\n\n${usage}`,
	);
	process.exitCode = 2;
} else {
	try {
		const { run } = await command.load();
		process.exitCode = await run(args);
	} catch (error) {
		if (!(error instanceof UsageError)) throw error;
		console.error(`grai: ${error.message}\n\n${usage}`);
		process.exitCode = 2;
	}
}
