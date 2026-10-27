import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { configFields, conventionalTests, strategies } from "../src/config.ts";
import { errorsOf } from "./project.ts";

/** The parts of config.schema.json the tests read. */
type Schema = {
	required: string[];
	properties: Record<
		string,
		{ items?: { anyOf?: { enum?: string[] }[] }; default?: unknown }
	>;
};

/** A JSON file of the package, parsed. */
function packageJson(file: string) {
	return JSON.parse(
		readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
	);
}

const schema: Schema = packageJson("config.schema.json");

it("describes every field the config takes, and no other", () => {
	expect(Object.keys(schema.properties)).toEqual(["$schema", ...configFields]);
	expect(schema.required).toEqual([
		"locales",
		"baseLocale",
		"catalogs",
		"outdir",
	]);
	expect(schema.properties.strategy?.items?.anyOf?.[0]?.enum).toEqual([
		...strategies,
	]);
	expect(schema.properties.tests?.default).toEqual(conventionalTests);
});

it("ships in the package, where a config's $schema names it", async () => {
	expect(packageJson("package.json")).toMatchObject({
		files: expect.arrayContaining(["config.schema.json"]),
	});
	expect(
		await errorsOf(
			{ en: { title: "Title" } },
			{ $schema: "./node_modules/@xyrolle/grai/config.schema.json" },
		),
	).toEqual([]);
});
