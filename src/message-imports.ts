/** A module of the output, by its import path: `messages.js` (`m`), `keys.js`, one key's path, or another. */
type MessageModule =
	| { type: "messages" | "keys" | "other" }
	| { type: "key"; key: string };

/** A name an import or re-export lists: the export it names, its local name, and where the export's name is. */
type ListedName = { imported: string; local: string; at: number };

/** An import, a re-export, or a dynamic import of a literal path, destructured or not. */
export type ImportStatement = {
	start: number;
	end: number;
	/** Whether it binds local names, as an import or a destructured dynamic import does. */
	binds: boolean;
	specifier: { at: number; text: string };
	module: MessageModule;
	names: ListedName[];
	/** The local name of `* as name`. */
	namespace: string | undefined;
};

/** What a file's imports bind of the messages: the namespaces of keys, and each key's local name. */
export type MessageBindings = {
	statements: ImportStatement[];
	/** Local names of `m` or a name it is exported as, whatever module it comes through, and of `import * as` keys.js. */
	namespaces: ReadonlySet<string>;
	/** Each local name bound to a key by a per-key import or a named import of keys.js, and its key. */
	keys: ReadonlyMap<string, string>;
	/** The lists of `export { … }` without a path, whose names are re-exported, not read. */
	reexports: readonly { start: number; end: number }[];
};

const name = "[A-Za-z_$][\\w$]*";
/** `import` or `export … from`: a default name, then `* as name` or a `{ … }` list, then the path. */
const statement = new RegExp(
	`\\b(?<keyword>import|export)\\s+(?:type\\s+)?(?:${name}\\s*,\\s*)?` +
		`(?:${name}|\\*\\s*(?:as\\s+(?<namespace>${name}))?|\\{(?<list>[^}]*)\\})` +
		`\\s*from\\s*(?<quote>["'])(?<specifier>[^"'\\r\\n]*)\\k<quote>`,
	"dg",
);
/** `const { key } = await import("…")`, as a test that loads a module late writes it. */
const destructuredImport = new RegExp(
	`\\b(?<keyword>const|let|var)\\s*\\{(?<list>[^}]*)\\}\\s*=\\s*await\\s+import\\s*\\(` +
		`\\s*(?<quote>["'])(?<specifier>[^"'\\r\\n]*)\\k<quote>\\s*\\)`,
	"dg",
);
const dynamicImport =
	/\bimport\s*\(\s*(?<quote>["'])(?<specifier>[^"'\r\n]*)\k<quote>\s*\)/dg;
const listedName = new RegExp(
	`(?<type>\\btype\\s+)?(?<imported>${name})(?:(?:\\s+as\\s+|\\s*:\\s*)(?<local>${name}))?`,
	"g",
);
const reexportList = /\bexport\s*(?:type\s*)?\{[^}]*\}(?!\s*from)/g;
const exportedNamespace = new RegExp(
	`\\bexport\\s*\\{[^}]*\\bm\\s+as\\s+(${name})`,
	"g",
);
const keyName = new RegExp(`^${name}$`);

/** The names a namespace goes by in the files: `m`, and each name a file exports it as. */
export function namespaceNames(texts: Iterable<string>): Set<string> {
	const names = new Set(["m"]);
	for (const text of texts) {
		for (const match of text.matchAll(exportedNamespace)) {
			names.add(match[1] ?? "m");
		}
	}
	return names;
}

/** A file's import statements, and what they bind of the messages, given the namespace's names. */
export function messageBindings(
	text: string,
	namespaceNames: ReadonlySet<string>,
): MessageBindings {
	const statements = [
		...statementsOf(text, statement),
		...statementsOf(text, destructuredImport),
		...statementsOf(text, dynamicImport),
	];
	const namespaces = new Set<string>();
	const keys = new Map<string, string>();
	for (const { binds, module, names, namespace } of statements) {
		if (!binds) continue;
		if (namespace !== undefined && module.type === "keys") {
			namespaces.add(namespace);
		}
		for (const { imported, local } of names) {
			if (namespaceNames.has(imported)) namespaces.add(local);
			const isKey =
				module.type === "keys" ||
				(module.type === "key" && module.key === imported);
			if (isKey) keys.set(local, imported);
		}
	}
	const reexports = [...text.matchAll(reexportList)].map((match) => ({
		start: match.index,
		end: match.index + match[0].length,
	}));
	return { statements, namespaces, keys, reexports };
}

/** The statement, if any, an offset lies in. */
export function statementAt(
	bindings: MessageBindings,
	at: number,
): ImportStatement | undefined {
	return bindings.statements.find(({ start, end }) => start <= at && at < end);
}

function statementsOf(text: string, pattern: RegExp): ImportStatement[] {
	return [...text.matchAll(pattern)].map((match) => {
		const groups = match.groups ?? {};
		const specifier = groups.specifier ?? "";
		return {
			start: match.index,
			end: match.index + match[0].length,
			binds: groups.keyword !== undefined && groups.keyword !== "export",
			specifier: {
				at: match.indices?.groups?.specifier?.[0] ?? 0,
				text: specifier,
			},
			module: moduleOf(specifier),
			names: listedNames(groups.list, match.indices?.groups?.list?.[0] ?? 0),
			namespace: groups.namespace,
		};
	});
}

function listedNames(list: string | undefined, listAt: number): ListedName[] {
	if (list === undefined) return [];
	return [...list.matchAll(listedName)].map((match) => {
		const { type = "", imported = "", local = imported } = match.groups ?? {};
		return { imported, local, at: listAt + match.index + type.length };
	});
}

/** The module an import path names, by its last segment without the extension. */
function moduleOf(specifier: string): MessageModule {
	const segments = specifier.split("/");
	const last = (segments.at(-1) ?? "").replace(/\.[cm]?[jt]s$/, "");
	if (segments.at(-2) === "messages" && keyName.test(last)) {
		return { type: "key", key: last };
	}
	if (last === "messages" || last === "keys") return { type: last };
	return { type: "other" };
}
