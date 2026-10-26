import { symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { projectWith, readingIn } from "./reading.ts";

describe("a reading of the files that may name a module outside the listed sources", () => {
	it("reads a file whose path may climb out of the roots, by as many segments `..` as that takes", async () => {
		const dir = projectWith({
			"shared/i18n.ts": 'export { m } from "../out/messages.js";\n',
			"tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "#lib/*": ["./src/lib/*"] } },
			}),
			"src/a.ts": 'import { m } from "../shared/i18n.ts";\nm.title();\n',
			"src/lib/deep/b.ts":
				'import { m } from "../../../shared/i18n.ts";\nm.title();\n',
			"src/lib/deep/c.ts":
				'import { m } from "#lib/../../shared/i18n.ts";\nm.title();\n',
			"src/lib/deep/d.ts":
				'import { e } from "../e.ts";\nexport const d = e;\n',
			"src/lib/deep/f.ts":
				'import { e } from "../../lib/e.ts";\nexport const f = e;\n',
			"src/lib/e.ts": "export const e = 1;\n",
		});

		expect(await readingIn(dir)).toEqual({
			read: ["src/a.ts", "src/lib/deep/b.ts", "src/lib/deep/c.ts"],
			reads: [
				"src/a.ts title",
				"src/lib/deep/b.ts title",
				"src/lib/deep/c.ts title",
			],
		});
	});

	it("reads a file that names a module outside the listed sources by an absolute path or a name that leads there", async () => {
		const dir = projectWith({
			"shared/i18n.ts": 'export { m } from "../out/messages.js";\n',
			"tsconfig.json": JSON.stringify({
				compilerOptions: { paths: { "@shared/*": ["./shared/*"] } },
			}),
			"src/build/i18n.ts": 'export { m } from "../../out/messages.js";\n',
			"src/a.ts": 'import { m } from "@shared/i18n";\nm.title();\n',
			"src/b.ts": 'import { m } from "./build/i18n.ts";\nm.title();\n',
			"src/d.ts": "export const d = 1;\n",
			"src/e.ts": 'import { m } from "./linked/i18n.ts";\nm.title();\n',
		});
		symlinkSync(join(dir, "shared"), join(dir, "src/linked"));
		writeFileSync(
			join(dir, "src/c.ts"),
			`import { m } from ${JSON.stringify(join(dir, "shared/i18n.ts"))};\nm.title();\n`,
		);

		expect(await readingIn(dir)).toEqual({
			read: ["src/a.ts", "src/b.ts", "src/c.ts", "src/e.ts"],
			reads: [
				"src/a.ts title",
				"src/b.ts title",
				"src/c.ts title",
				"src/e.ts title",
			],
		});
	});
});
