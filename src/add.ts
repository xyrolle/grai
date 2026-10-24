import { catalogWithMessages } from "./catalog-file.ts";
import {
	type CompileResult,
	compile,
	parseCatalogs,
	readProject,
} from "./compile.ts";
import { GraiError, sortErrors } from "./error.ts";
import { isKeyName } from "./key-checks.ts";
import { parseMessage } from "./message.ts";
import { MessageProblem } from "./problem.ts";
import { writeAll } from "./write-all.ts";

/**
 * Adds a key to every catalog, with its text in each locale, then compiles. It writes nothing
 * unless every locale's text is given, the key is new, and every text is a valid message.
 */
export async function add(
	configFile: string,
	key: string,
	texts: Readonly<Record<string, string>>,
): Promise<CompileResult> {
	const read = await readProject(configFile);
	if ("errors" in read) return { written: [], errors: read.errors };
	const { catalogs, errors } = parseCatalogs(read.sources);
	if (errors.length > 0) return { written: [], errors };
	const base = catalogs.find(
		(catalog) => catalog.locale === read.config.baseLocale,
	);
	const file = base?.file ?? "";
	const problems: GraiError[] = [];
	const existing = catalogs
		.flatMap((catalog) => [...catalog.messages.keys()])
		.find((other) => other.toLowerCase() === key.toLowerCase());
	if (!isKeyName(key)) {
		problems.push(
			new GraiError(
				"key-invalid",
				{ file, key },
				"a key must be a JavaScript identifier and not a reserved word. Use letters, digits, _ and $.",
			),
		);
	} else if (existing !== undefined) {
		problems.push(
			existing === key
				? new GraiError(
						"key-exists",
						{ file, key },
						"the key is already in the catalogs. Edit its messages there.",
					)
				: new GraiError(
						"key-invalid",
						{ file, key },
						`the key differs from "${existing}" only in case. Choose another name.`,
					),
		);
	}
	for (const catalog of catalogs) {
		const text = texts[catalog.locale];
		const where = { file: catalog.file, key, locale: catalog.locale };
		if (text === undefined) {
			problems.push(
				new GraiError(
					"key-missing",
					where,
					`give the key's text in ${catalog.locale} too, with --${catalog.locale}.`,
				),
			);
			continue;
		}
		try {
			parseMessage(catalog.locale, text);
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			problems.push(new GraiError(error.code, where, error.message));
		}
	}
	if (problems.length > 0) return { written: [], errors: sortErrors(problems) };
	const catalogTexts = new Map<string, string>();
	for (const [locale, path] of read.config.catalogs) {
		catalogTexts.set(
			path,
			catalogWithMessages(path, [[key, texts[locale] ?? ""]], path),
		);
	}
	writeAll(catalogTexts);
	return compile(configFile);
}
