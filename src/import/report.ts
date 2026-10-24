/** A message the import left out or changed: its source file and key as the source names them, and the locales it is about. */
export type ImportNotice = {
	file: string;
	key: string;
	locales: readonly string[];
	detail: string;
};

/** What an import left out of every locale, and what it imported that renders differently. */
export type ImportReport = {
	leftOut: ImportNotice[];
	changed: ImportNotice[];
};

/** One locale's word on a message: why it was left out, or how it renders differently. */
export type LocaleDetail = { locale: string; detail: string };

/** A message's notices: each detail once, with every locale it is about. */
export function noticesOf(
	where: { file: string; key: string },
	details: readonly LocaleDetail[],
): ImportNotice[] {
	return [...Map.groupBy(details, ({ detail }) => detail)].map(
		([detail, group]) => ({
			...where,
			locales: group.map(({ locale }) => locale),
			detail,
		}),
	);
}

/** The report as lines: each message left out, then each difference, one many messages share said once. */
export function reportLines({ leftOut, changed }: ImportReport): string[] {
	const lines = leftOut.map((notice) => `left out: ${line(notice)}`);
	for (const [detail, notices] of Map.groupBy(
		changed,
		(notice) => notice.detail,
	)) {
		const [first, ...others] = notices;
		if (first === undefined) continue;
		lines.push(
			others.length === 0
				? `changed: ${line(first)}`
				: `changed: ${notices.length} messages, such as "${first.key}": ${detail}`,
		);
	}
	return lines;
}

/** What a written import did: the keys and catalogs, and how many keys it left out. */
export function summaryLine({
	keys,
	written,
	leftOut,
}: ImportReport & { keys: number; written: readonly string[] }): string {
	const left = new Set(leftOut.map((notice) => notice.key)).size;
	return `grai: imported ${keys} ${keys === 1 ? "key" : "keys"} into ${written.join(", ")}${left > 0 ? `, and left ${left} out` : ""}`;
}

function line({ file, key, locales, detail }: ImportNotice): string {
	return `${file}: "${key}" (${locales.join(", ")}): ${detail}`;
}
