import { type Catalog, fileOfKey } from "./catalog.ts";
import { GraiError } from "./error.ts";
import { type LocaleMessage, parseMessage } from "./message.ts";
import { MessageProblem } from "./problem.ts";

/**
 * A key's message in each locale parsed, from its raw `values`, one per catalog, or undefined
 * when one does not parse: its error is added to `errors`, named by the file the message is in,
 * the catalog's own or the one `sources` has it fall back to.
 */
export function parseMessages(
	key: string,
	catalogs: readonly Catalog[],
	sources: readonly (Catalog | undefined)[],
	values: readonly unknown[],
	errors: GraiError[],
): LocaleMessage[] | undefined {
	const messages: LocaleMessage[] = [];
	catalogs.forEach((catalog, index) => {
		const { locale } = catalog;
		try {
			messages.push(parseMessage(locale, values[index]));
		} catch (error) {
			if (!(error instanceof MessageProblem)) throw error;
			const file = fileOfKey(sources[index] ?? catalog, key);
			const where = { file, key, locale };
			errors.push(new GraiError(error.code, where, error.message));
		}
	});
	return messages.length === catalogs.length ? messages : undefined;
}
