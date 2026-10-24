import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { recompile } from "../src/compile.ts";
import { keyPositions } from "../src/declaration-maps.ts";
import { definitionOf } from "./language-server.ts";
import { project } from "./project.ts";

it("takes go to definition from a message to its key in the base locale's catalog", async () => {
	const { dir, config } = project({
		en: { cart_title: "Your cart", cart_greeting: "Hello {name}" },
		de: { cart_title: "Ihr Warenkorb", cart_greeting: "Hallo {name}" },
	});
	const first = await recompile(config, undefined);
	const catalog = join(dir, "messages", "en.json");

	expect(await definitionOf(dir, "cart_greeting")).toEqual([catalog, 2, 2]);

	writeFileSync(
		catalog,
		readFileSync(catalog, "utf8").replace(
			"{\n",
			'{\n\t"cart_empty": "Empty",\n',
		),
	);
	writeFileSync(
		join(dir, "messages", "de.json"),
		readFileSync(join(dir, "messages", "de.json"), "utf8").replace(
			"{\n",
			'{\n\t"cart_empty": "Leer",\n',
		),
	);
	await recompile(config, first.build);

	expect(await definitionOf(dir, "cart_greeting")).toEqual([catalog, 3, 2]);
});

it("finds the keys of a catalog on one line where their names are written", () => {
	expect([
		...keyPositions('{"cart_title":"Your cart","cart_items":["x"]}'),
	]).toEqual([
		["cart_title", [0, 2]],
		["cart_items", [0, 27]],
	]);
});
