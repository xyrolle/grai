import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type InlineConfig, parseSync } from "vite";
import { describe, expect, it } from "vitest";
import { recompile } from "../src/compile.ts";
import { devModule } from "../src/dev-module.ts";
import { textModulePrefix } from "../src/locale-chunks.ts";
import { calledNames, everyName } from "../src/output-imports.ts";
import { grai } from "../src/vite.ts";
import { textModule } from "../src/vite-build.ts";
import { project } from "./project.ts";

/**
 * Keys named as what a module of keys calls: the runtime's functions, plurals.js's, a formatter
 * of formats.js, the dev module's own bindings, and globals the compiled code reads. Each of the
 * messages that reach for one of those has another of them as its key.
 */
const catalog = {
	text: "Text",
	pageText: "Page text",
	message: "Hello {name}",
	markup: "Read {#b}this{/b}, {name}",
	unmatched: [
		{
			declarations: ["input kind"],
			selectors: ["kind"],
			match: { "kind=a": "A", "kind=b": "B" },
		},
	],
	plural_en: [
		{
			declarations: ["input count", "local countPlural = count: plural"],
			selectors: ["countPlural"],
			match: {
				"countPlural=one": "{count} item",
				"countPlural=*": "{count} items",
			},
		},
	],
	number_en: "{amount :number}",
	integer: [
		{
			declarations: ["input count", "local n = count: integer"],
			selectors: ["n"],
			match: { "n=2": "two", "n=*": "other" },
		},
	],
	String: [
		{
			declarations: ["input kind"],
			selectors: ["kind"],
			match: { "kind=1": "first", "kind=*": "{kind}" },
		},
	],
	Number: [
		{
			declarations: ["input count", "local n = count: number"],
			selectors: ["n"],
			match: { "n=1": "one", "n=*": "more" },
		},
	],
	Intl: "Intl",
	Object: "Object",
	T: "T",
	live: "Live",
	location: "Location",
	window: "Window",
};

/** Each key's call, as its inputs, and what it should say. */
const calls: Record<string, [inputs: object | undefined, says: unknown]> = {
	text: [undefined, "Text"],
	pageText: [undefined, "Page text"],
	message: [{ name: "Ana" }, "Hello Ana"],
	markup: [{ name: "Ana" }, "Read this, Ana"],
	unmatched: [{ kind: "b" }, "B"],
	plural_en: [{ count: 1 }, "1 item"],
	number_en: [{ amount: 1234.5 }, new Intl.NumberFormat("en").format(1234.5)],
	integer: [{ count: 2.2 }, "two"],
	String: [{ kind: 1 }, "first"],
	Number: [{ count: 1 }, "one"],
	Intl: [undefined, "Intl"],
	Object: [undefined, "Object"],
	T: [undefined, "T"],
	live: [undefined, "Live"],
	location: [undefined, "Location"],
	window: [undefined, "Window"],
};

const expected = Object.fromEntries(
	Object.entries(calls).map(([key, [, says]]) => [key, says]),
);

/**
 * What a module's keys say, imported by Node itself in a process of its own: Vitest's module
 * transform reads every import as a property, which would hide a key that takes an import's name.
 */
function said(
	file: string,
	keys = Object.keys(calls),
): Record<string, unknown> {
	const script = `const m = await import(${JSON.stringify(pathToFileURL(file).href)});
const calls = ${JSON.stringify(Object.fromEntries(keys.map((key) => [key, calls[key]?.[0] ?? null])))};
const said = {};
for (const [key, inputs] of Object.entries(calls)) said[key] = typeof m[key] === "function" ? m[key](inputs ?? undefined) : m[key];
console.log(JSON.stringify(said));`;
	const run = spawnSync(
		process.execPath,
		["--input-type=module", "-e", script],
		{
			encoding: "utf8",
		},
	);
	if (run.status !== 0) throw new Error(run.stderr);
	return JSON.parse(run.stdout);
}

describe("a key named as something the output's code calls", () => {
	it("compiles in keys.js", async () => {
		const { dir, compile } = project({ en: catalog });
		expect((await compile()).errors).toEqual([]);
		expect(said(join(dir, "out", "keys.js"))).toEqual(expected);
	});

	it("compiles in the dev module", async () => {
		const { dir, config } = project({ en: catalog });
		const { build: compiled } = await recompile(config, undefined);
		if (compiled === undefined) throw new Error("the compile failed");
		const file = join(dir, "out", "dev.js");
		writeFileSync(file, devModule(join(dir, "out"), compiled));
		expect(said(file)).toEqual(expected);
	});

	it("compiles in a Vite client build and server build", async () => {
		const { dir } = project({ en: catalog });
		const entry = join(dir, "entry.js");
		writeFileSync(entry, `export * from "./out/keys.js";\n`);
		const options = (outDir: string, ssr: boolean): InlineConfig => ({
			root: dir,
			configFile: false,
			logLevel: "silent",
			plugins: [grai()],
			build: ssr
				? { ssr: entry, outDir }
				: {
						outDir,
						rolldownOptions: {
							input: entry,
							preserveEntrySignatures: "strict",
						},
					},
		});
		await build(options(join(dir, "server"), true));
		expect(said(join(dir, "server", "entry.mjs"))).toEqual(expected);
		await build(options(join(dir, "client"), false));
		const assets = join(dir, "client", "assets");
		const client = readdirSync(assets).find((file) => file.startsWith("entry"));
		expect(said(join(assets, client ?? ""))).toEqual(expected);
	});

	it("compiles in grai/svelte's module of a text key's string", async () => {
		const { dir, config } = project({ en: catalog });
		const { build: compiled } = await recompile(config, undefined);
		if (compiled === undefined) throw new Error("the compile failed");
		const outdir = join(dir, "out");
		const file = join(outdir, "page-text.js");
		const code = textModule(outdir, compiled, `${textModulePrefix}pageText`);
		writeFileSync(file, code ?? "");
		expect(said(file, ["pageText"])).toEqual({ pageText: "Page text" });
	});
});

/** A message of every shape, each calling what its shape's code calls. */
const shapes = {
	title: "Your cart",
	greeting: "Hello {name}",
	items: [
		{
			declarations: ["input count", "local plural = count: plural"],
			selectors: ["plural"],
			match: { "plural=one": "{count} item", "plural=*": "{count} items" },
		},
	],
	place: [
		{
			declarations: ["input n", "local nOrdinal = n: plural type=ordinal"],
			selectors: ["nOrdinal"],
			match: { "nOrdinal=one": "{n}st", "nOrdinal=*": "{n}th" },
		},
	],
	speed: [
		{
			declarations: ["input speed"],
			selectors: ["speed"],
			match: { "speed=fast": "Fast", "speed=slow": "Slow" },
		},
	],
	left: [
		{
			declarations: ["input count", "local n = count: integer"],
			selectors: ["n"],
			match: { "n=0": "None", "n=one": "One", "n=*": "{n}" },
		},
	],
	more: [
		{
			declarations: ["input count", "local n = count: number"],
			selectors: ["n"],
			match: { "n=1": "one", "n=*": "{n}" },
		},
	],
	share: [
		{
			declarations: ["input share", "local n = share: percent"],
			selectors: ["n"],
			match: { "n=50": "half", "n=*": "{n}" },
		},
	],
	terms: "Read the {#link href=|/terms| rel=$rel}terms{/link}, {name}",
	total: "Total {amount :number style=currency currency=EUR}",
	converted: "In {amount :currency currency=$code}",
	shipped: "Shipped {when :date}",
	at: "At {when :datetime timeStyle=short timeZone=$zone}",
	guests: "With {names :list}, {days :relativetime unit=day}",
};

/**
 * The names an expression refers to and does not bind itself: each identifier but a property's
 * name, less the names its functions bind.
 */
function freeNames(code: string): Set<string> {
	const { program, errors } = parseSync("value.js", `(${code});`);
	if (errors.length > 0) throw new Error(errors[0]?.message);
	const bound = new Set<string>();
	const named = new Set<string>();
	const visit = (node: unknown, role: "reference" | "binding" | "name") => {
		if (Array.isArray(node)) {
			for (const each of node) visit(each, role);
			return;
		}
		if (typeof node !== "object" || node === null || !("type" in node)) return;
		if (node.type === "Identifier" && "name" in node) {
			const into = { reference: named, binding: bound, name: undefined }[role];
			into?.add(String(node.name));
			return;
		}
		const computed = "computed" in node && node.computed === true;
		for (const [field, child] of Object.entries(node)) {
			if (node.type === "MemberExpression" && field === "property" && !computed)
				visit(child, "name");
			else if (node.type === "Property" && field === "key" && !computed)
				visit(child, "name");
			else if (
				field === "params" ||
				(node.type === "VariableDeclarator" && field === "id")
			)
				visit(child, "binding");
			else visit(child, "reference");
		}
	};
	visit(program, "reference");
	return new Set([...named].filter((name) => !bound.has(name)));
}

describe("a key's code", () => {
	it("calls nothing but the names its module records, so the module knows each name a key could take", async () => {
		const { config } = project({ en: shapes });
		const { build: compiled } = await recompile(config, undefined);
		if (compiled === undefined) throw new Error("the compile failed");
		for (const [key, value] of compiled.compilation.keys) {
			const recorded = everyName(calledNames([value], value.uses));
			for (const code of [value.value, value.serverValue])
				expect({
					key,
					calls: [...freeNames(code)].filter((name) => !recorded.has(name)),
				}).toEqual({ key, calls: [] });
		}
	});

	it("binds a key that takes no name under its own name, and one that does under a name of its own", async () => {
		const { dir, compile } = project({ en: { title: "Title", text: "Text" } });
		expect((await compile()).errors).toEqual([]);
		const shard = readdirSync(join(dir, "out", "keys")).find((file) =>
			file.endsWith(".js"),
		);
		const code = readFileSync(join(dir, "out", "keys", shard ?? ""), "utf8");
		expect(code).toContain('export const title = /*#__PURE__*/ text("Title");');
		expect(code).toContain(
			'const $text = /*#__PURE__*/ text("Text");\nexport { $text as text };',
		);
	});
});
