import { readConfig } from "../config.ts";
import { seed } from "../seed.ts";
import { failed, parsed, reported, UsageError } from "./command.ts";

/** `grai seed`: what it does with its arguments, returning the exit code. */
export async function run(args: string[]): Promise<number> {
	const { config, positionals } = parsed(args);
	const [locale, ...others] = positionals;
	if (locale === undefined || others.length > 0) {
		throw new UsageError("seed takes one locale");
	}
	const started = performance.now();
	const seeded = await seed(config, locale);
	if ("errors" in seeded) return failed(seeded.errors);
	const base = readConfig(config).baseLocale;
	const files = seeded.files.join(", ");
	console.log(
		seeded.keys === 0
			? `grai: ${files} ${seeded.files.length === 1 ? "has" : "have"} every key of ${base}`
			: `grai: seeded ${seeded.keys} ${seeded.keys === 1 ? "key" : "keys"} into ${files} with the text of ${base}`,
	);
	return reported(config, seeded.result, performance.now() - started);
}
