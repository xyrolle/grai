import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.ts";
import { removeUnusedKeys } from "../src/fix.ts";
import { rename } from "../src/rename.ts";
import { exportLocale } from "../src/translations.ts";
import { project } from "./project.ts";

const descriptions = "messages/descriptions.json";

describe("translators' descriptions", () => {
	it("are each a note of the key's units in an export", async () => {
		const { dir, config } = project(
			{
				en: { open: "Open", close: "Close" },
				de: { open: "Open", close: "Close" },
			},
			{ descriptions },
		);
		writeFileSync(join(dir, descriptions), JSON.stringify({ open: "A verb" }));
		const exported = async (json: boolean) => {
			const result = await exportLocale(config, "de", {
				json,
				untranslated: false,
			});
			return "document" in result ? result.document : "";
		};

		expect(await exported(false)).toContain(
			'<unit id="open" name="open">\n\t\t\t<notes><note category="description">A verb</note></notes>',
		);
		expect(JSON.parse(await exported(true)).units).toEqual([
			{ id: "open", key: "open", description: "A verb", source: "Open" },
			{ id: "close", key: "close", source: "Close" },
		]);
	});

	it("follow their key through rename and check --fix", async () => {
		const { dir, config } = project(
			{
				en: { open: "Open", close: "Close", gone: "Gone" },
				de: { open: "Öffnen", close: "Schließen", gone: "Weg" },
			},
			{ descriptions },
		);
		writeFileSync(
			join(dir, descriptions),
			JSON.stringify({ open: "A verb", gone: "Unused" }, null, "\t"),
		);
		writeFileSync(
			join(dir, "app.ts"),
			'import { m } from "./out/messages.js";\nm.open();\nm.close();\n',
		);

		await rename(config, "open", "open_menu");
		await removeUnusedKeys(config);

		expect(JSON.parse(readFileSync(join(dir, descriptions), "utf8"))).toEqual({
			open_menu: "A verb",
		});
	});

	it("are reported by check when no catalog has their key, or the file holds something else", async () => {
		const { dir, config } = project(
			{ en: { open: "Open" }, de: { open: "Öffnen" } },
			{ descriptions },
		);
		writeFileSync(join(dir, "app.ts"), "m.open();");
		const problems = async (text: string) => {
			writeFileSync(join(dir, descriptions), text);
			return (await check(config)).problems.map((error) => error.message);
		};

		expect(await problems('{ "open": "A verb", "opne": "A typo" }')).toEqual([
			'messages/descriptions.json: "opne": no catalog has the key it describes. Remove it, or fix its name.',
		]);
		expect(await problems('{ "open": 1 }')).toEqual([
			'messages/descriptions.json: it must hold a JSON object of each key\'s description, a text, such as { "open": "A verb: the button opens the menu" }.',
		]);
	});
});
