// How the server benches call a library: a page of the sample's static call sites, 20 to a
// function, as a server's render code holds them, bundled with the library's module. grai's and
// Paraglide's pages import every key the module exports and keep them all, as a server holds
// every key, though the sample calls only some; i18next's and use-intl's call `t(key, values)`,
// and a page of an object of every key reads each off `m`.
// Every page exports `render(values, options)`, whose options name the locale where a module
// holds every locale.

/**
 * How a page calls one key: through `t`, a key's function with or without the options, or a key
 * read off an object `m` of every key.
 */
const callers = {
	t: ({ key, value }) => `t(${JSON.stringify(key)}, ${value})`,
	module: ({ name, value }) => `${name}(${value})`,
	options: ({ name, value }) => `${name}(${value}, o)`,
	m: ({ key, value }) => `m[${JSON.stringify(key)}](${value}, o)`,
};

/** What a page imports for each way of calling: `t`, `m`, or every key by name, all kept. */
function importCode(entry, mode, names, alias) {
	const from = JSON.stringify(entry);
	if (mode === "t" || mode === "m") return `import { ${mode} } from ${from};`;
	const imported = names.map(
		(name) => `${JSON.stringify(name)} as ${alias.get(name)}`,
	);
	return `import { ${imported.join(", ")} } from ${from};\nexport const every = [${[...alias.values()].join(", ")}];`;
}

/**
 * A page's code: its import from `entry`, which exports `names` (every key, or `t` or `m`), and a
 * render of `keys`, the sample's keys in order, each called as `mode` says.
 */
export function pageCode(entry, mode, names, keys) {
	const alias = new Map(names.map((name, index) => [name, `k${index}`]));
	const parts = [];
	const lines = [importCode(entry, mode, names, alias)];
	for (let start = 0; start < keys.length; start += 20) {
		const body = keys
			.slice(start, start + 20)
			.map(
				(key, offset) =>
					`\ts += ${callers[mode]({ key, value: `d[${start + offset}]`, name: alias.get(key) })};`,
			);
		lines.push(
			`function part${parts.length}(d, o) {\n\tlet s = "";\n${body.join("\n")}\n\treturn s;\n}`,
		);
		parts.push(`part${parts.length}(d, o)`);
	}
	lines.push(
		`export function render(d, o) {\n\treturn ${parts.join(" + ")};\n}`,
	);
	return `${lines.join("\n")}\n`;
}
