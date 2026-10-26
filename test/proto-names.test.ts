import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { recompile } from "../src/compile.ts";
import { devModule, patchModule } from "../src/dev-module.ts";
import { project } from "./project.ts";

/**
 * A name an object literal written `{ __proto__: … }` would take as its prototype, not as a
 * property: a key of the catalog, a markup option and a markup attribute named so.
 */
const catalog = {
	["__proto__"]: "Hello {name}",
	title: "Title",
	terms: "Read {#b __proto__=$opts @__proto__=|attr|/}",
};

const catalogs = { en: catalog };

describe("a name that an object literal would take for its prototype", () => {
	it("is a markup option's and an attribute's own property in the parts", async () => {
		const { m } = await project(catalogs).load();
		const opts = { colour: "red" };
		const part = m.terms
			?.parts?.({ opts })
			?.find((each) => each.type !== "text");

		expect(part && Object.hasOwn(part.options, "__proto__")).toBe(true);
		expect(
			part && Object.getOwnPropertyDescriptor(part.options, "__proto__")?.value,
		).toBe(opts);
		expect(
			part &&
				Object.getOwnPropertyDescriptor(part.attributes, "__proto__")?.value,
		).toBe("attr");
		expect(part && Object.getPrototypeOf(part.options)).toBe(Object.prototype);
	});

	it("is a key the dev module exports as its message, and an edit's patch carries", async () => {
		const { dir, config } = project(catalogs);
		const { build } = await recompile(config, undefined);
		if (build === undefined) throw new Error("the compile failed");
		const outdir = join(dir, "out");
		const dev = join(outdir, "dev.js");
		writeFileSync(dev, devModule(outdir, build));
		const patch = join(outdir, "patch.js");
		writeFileSync(patch, patchModule(outdir, build, ["__proto__"]));
		// Node itself imports them: Vitest's transform writes a module's exports into an object, where
		// `__proto__` would be the prototype again.
		const script = `const m = await import(${JSON.stringify(pathToFileURL(dev).href)});
const { rows } = await import(${JSON.stringify(pathToFileURL(patch).href)});
const message = Object.getOwnPropertyDescriptor(m, "__proto__")?.value;
console.log(JSON.stringify([message?.({ name: "Ana" }), m.title(), Object.hasOwn(rows, "__proto__")]));`;
		const run = spawnSync(
			process.execPath,
			["--input-type=module", "-e", script],
			{
				encoding: "utf8",
			},
		);

		expect(run.stderr).toBe("");
		expect(JSON.parse(run.stdout)).toEqual(["Hello Ana", "Title", true]);
	});
});
