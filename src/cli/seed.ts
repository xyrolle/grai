import { readConfig } from "../config.ts";
import { seed } from "../seed.ts";
import {
	type Command,
	failed,
	parsed,
	reported,
	UsageError,
} from "./command.ts";

export const seedCommand: Command = {
	usage: `  seed <locale>                give the locale's catalog the base text of each key it lacks,
                               creating it if need be, then compile`,
	async run(args) {
		const { config, positionals } = parsed(args);
		const [locale, ...others] = positionals;
		if (locale === undefined || others.length > 0) {
			throw new UsageError("seed takes one locale");
		}
		const started = performance.now();
		const seeded = await seed(config, locale);
		if ("errors" in seeded) return failed(seeded.errors);
		const base = readConfig(config).baseLocale;
		console.log(
			seeded.keys === 0
				? `grai: ${seeded.file} has every key of ${base}`
				: `grai: seeded ${seeded.keys} ${seeded.keys === 1 ? "key" : "keys"} into ${seeded.file} with the text of ${base}`,
		);
		return reported(config, seeded.result, performance.now() - started);
	},
};
