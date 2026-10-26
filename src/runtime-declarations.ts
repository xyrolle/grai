import type { Config, LocaleSwitch } from "./config.ts";

/**
 * The output's declaration files as the package ships them, beside the runtime's modules:
 * `runtime/<name>.d.ts.template`, the text of the output's `<name>.d.ts`. A `<name>.d.ts` there
 * would be the types TypeScript takes for `<name>.js` when the repo checks the runtime; a
 * `.template` is a file TypeScript never reads. They ship as text rather than as strings in the
 * compiler's modules, so a bundle of the compiler does not carry them.
 */
export type DeclarationTemplates = {
	/** runtime.d.ts, the runtime's API, but for the lines a config decides. */
	runtime: string;
	server: string;
	testing: string;
	/** The declaration of setLocale under each `switch`. */
	setLocale: Record<LocaleSwitch, string>;
};

/**
 * runtime.d.ts for a config: its template with the project's locales in place of `%LOCALE_UNION%`
 * and `%LOCALE_LIST%`, its base locale in place of `%BASE_LOCALE%`, and the line `%SET_LOCALE%`
 * the declaration of setLocale under its `switch`.
 */
export function runtimeDeclarations(
	templates: DeclarationTemplates,
	config: Config,
): string {
	const locales = config.locales.map((locale) => JSON.stringify(locale));
	// Each replacement is a function, so a `$` in what it gives is never read as a pattern.
	return templates.runtime
		.replace("%LOCALE_UNION%", () => locales.join(" | "))
		.replace("%LOCALE_LIST%", () => locales.join(", "))
		.replace("%BASE_LOCALE%", () => JSON.stringify(config.baseLocale))
		.replace("%SET_LOCALE%\n", () => templates.setLocale[config.switch]);
}
