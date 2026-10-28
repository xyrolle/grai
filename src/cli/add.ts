import type { ParseArgsOptionsConfig } from "node:util";
import { add } from "../add.ts";
import { readConfig } from "../config.ts";
import { GraiError } from "../error.ts";
import { failed, parsed, reported, UsageError } from "./command.ts";

/** `grai add`: what it does with its arguments, returning the exit code. */
export async function run(args: string[]): Promise<number> {
	const { config } = parsed(args, {}, false);
	let locales: readonly string[];
	try {
		locales = readConfig(config).locales;
	} catch (error) {
		if (error instanceof GraiError) return failed([error]);
		throw error;
	}
	const flags: ParseArgsOptionsConfig = {};
	for (const locale of locales) flags[locale] = { type: "string" };
	const { values, positionals } = parsed(args, flags);
	const [key, ...others] = positionals;
	if (key === undefined || others.length > 0) {
		throw new UsageError(
			"add takes one key, and the key's text in each locale",
		);
	}
	const texts: Record<string, string> = {};
	for (const locale of locales) {
		const text = values[locale];
		if (typeof text === "string") texts[locale] = text;
	}
	const started = performance.now();
	return reported(
		config,
		await add(config, key, texts),
		performance.now() - started,
	);
}
