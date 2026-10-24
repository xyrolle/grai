/** A tag of the page's head, as unhead gives it to its `ssr:render` hook. */
export type HeadTag = {
	tag: string;
	props: Record<string, string>;
	innerHTML?: string;
};

/**
 * Points a page at its locale's copies of the message chunks, which grai/vite writes to
 * `grai-<locale>/` beside the shared `grai/`, in the directory of Nuxt's chunks. One entry,
 * merged into the import map Nuxt writes for its entry, maps the shared directory to the
 * locale's, for every message chunk the page and its later navigations import. The links that
 * preload or prefetch a shared chunk name the locale's copy instead, as browsers apply no import
 * map to them and would fetch both. A page without Nuxt's import map is left as it is: it still
 * works, with every locale's words.
 */
export function pointAtLocaleChunks(tags: HeadTag[], locale: string): void {
	const map = tags.find(
		(tag) => tag.tag === "script" && tag.props.type === "importmap",
	);
	const parsed: unknown = JSON.parse(map?.innerHTML ?? "null");
	if (map === undefined || !isRecord(parsed) || !isRecord(parsed.imports))
		return;
	const entry = parsed.imports["#entry"];
	if (typeof entry !== "string") return;
	const chunks = entry.slice(0, entry.lastIndexOf("/") + 1);
	const shared = `${chunks}grai/`;
	const copies = `${chunks}grai-${locale}/`;
	parsed.imports[shared] = copies;
	map.innerHTML = JSON.stringify(parsed);
	for (const { tag, props } of tags) {
		if (tag === "link" && props.href?.startsWith(shared)) {
			props.href = copies + props.href.slice(shared.length);
		}
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
