import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check } from "../src/check.ts";
import { project } from "./project.ts";

/** The problems check reports for the catalogs, with a source that names each key. */
async function problemsOf(
	catalogs: Record<string, unknown>,
): Promise<string[]> {
	const { dir, config } = project(catalogs);
	writeFileSync(join(dir, "app.ts"), "m.invited(); m.files();");
	const { problems } = await check(config);
	return problems.map((error) => error.message);
}

describe("grai check's inputs", () => {
	it("takes an input a locale only chooses by as its grammar, which another locale need not read", async () => {
		const invited = [
			{
				declarations: ["input name", "input gender"],
				selectors: ["gender"],
				match: {
					"gender=female": "Vous êtes invitée, {name}",
					"gender=*": "Vous êtes invité, {name}",
				},
			},
		];

		expect(
			await problemsOf({
				en: { invited: "You're invited, {name}", files: "Files" },
				fr: { invited, files: "Fichiers" },
			}),
		).toEqual([]);
	});

	it("reports a locale that only chooses by an input another shows, as a placeholder it lost", async () => {
		const files = [
			{
				declarations: ["input count", "local countPlural = count: plural"],
				selectors: ["countPlural"],
				match: {
					"countPlural=one": "Un fichier",
					"countPlural=*": "Des fichiers",
				},
			},
		];

		expect(
			await problemsOf({
				en: { invited: "You're invited", files: "{count} files" },
				fr: { invited: "Vous êtes invité", files },
			}),
		).toEqual([
			'messages/fr.json: "files" (fr): the message never shows {count}, which en shows. Show it here too, or drop it everywhere.',
		]);
	});
});
