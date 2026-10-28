import { exportLocale } from "../translations.ts";
import { failed, parsed, UsageError } from "./command.ts";

/** `grai export`: what it does with its arguments, returning the exit code. */
export async function run(args: string[]): Promise<number> {
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
}
