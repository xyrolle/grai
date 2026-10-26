import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";
import { writeAll } from "../src/write-all.ts";

/** A temporary directory, removed after the test. */
function directory(): string {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-write-")));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

it("leaves every other file as it was, a file named as the catalog's temporary one among them", () => {
	const dir = directory();
	const catalog = join(dir, "en.json");
	writeFileSync(catalog, "{}");
	writeFileSync(`${catalog}.tmp`, "a copy kept by hand");

	writeAll(new Map([[catalog, '{ "title": "Title" }']]));

	expect(readFileSync(catalog, "utf8")).toBe('{ "title": "Title" }');
	expect(readFileSync(`${catalog}.tmp`, "utf8")).toBe("a copy kept by hand");
	expect(readdirSync(dir).sort()).toEqual(["en.json", "en.json.tmp"]);
});

it("changes no file when one of them cannot be replaced, and leaves nothing behind", () => {
	const dir = directory();
	const en = join(dir, "en.json");
	const added = join(dir, "fr.json");
	const de = join(dir, "de.json");
	writeFileSync(en, '{ "title": "Title" }');
	chmodSync(en, 0o755);
	mkdirSync(de);

	expect(() =>
		writeAll(
			new Map([
				[en, '{ "title": "Heading" }'],
				[added, '{ "title": "Titre" }'],
				[de, '{ "title": "Titel" }'],
			]),
		),
	).toThrow(/EISDIR|EPERM/);
	expect(readFileSync(en, "utf8")).toBe('{ "title": "Title" }');
	expect(statSync(en).mode & 0o777).toBe(0o755);
	expect(readdirSync(dir).sort()).toEqual(["de.json", "en.json"]);
});

it("keeps each file's permissions, an executable script's among them", () => {
	const dir = directory();
	const script = join(dir, "build.js");
	writeFileSync(script, "#!/usr/bin/env node\nconsole.log(m.title());\n");
	chmodSync(script, 0o755);

	writeAll(
		new Map([[script, "#!/usr/bin/env node\nconsole.log(m.heading());\n"]]),
	);

	expect(statSync(script).mode & 0o777).toBe(0o755);
});
