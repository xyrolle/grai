import { exportLocale } from "../translations.ts";
import { type Command, failed, parsed, UsageError } from "./command.ts";

export const exportCommand: Command = {
	usage: `  export <locale> [--untranslated] [--json]
                               print the locale's messages for translators, as XLIFF 2.0, or
                               as JSON for scripts: every key, or the untranslated ones`,
	async run(args) {
		const { config, values, positionals } = parsed(args, {
			untranslated: { type: "boolean" },
			json: { type: "boolean" },
		});
		const [locale, ...others] = positionals;
		if (locale === undefined || others.length > 0) {
			throw new UsageError("export takes one locale");
		}
		const exported = await exportLocale(config, locale, {
			json: values.json === true,
			untranslated: values.untranslated === true,
		});
		if ("errors" in exported) return failed(exported.errors);
		process.stdout.write(exported.document);
		return 0;
	},
};
