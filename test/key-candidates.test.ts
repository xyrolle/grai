import { describe, expect, it } from "vitest";
import { textTest } from "../src/code/candidates.ts";
import { keyNamesOf } from "../src/code/key-candidates.ts";
import { fullReadingIn, projectWith } from "./reading.ts";

const outdir = "/p/src/lib/grai";

describe("the names a file must write to read one key", () => {
	const holders = {
		messages: `${outdir}/messages.js`,
		keys: `${outdir}/keys.js`,
		barrels: new Set(["/p/src/lib/labels.ts"]),
	};

	it("takes the key's name whole, a path that ends at messages.js or keys.js, and a barrel that holds the key", () => {
		const names = keyNamesOf("heading", holders, [], [], []);
		const test = names && textTest(names);
		const taken = [
			"m.heading();",
			'import { m } from "./lib/grai/messages.js";',
			'import * as all from "../grai/keys";',
			'import { m } from "./lib/labels";',
		];
		const left = [
			'import { caption } from "./lib/grai/messages/caption.js";',
			"Object.keys(rows).length;",
			"this.messages.push(row);",
			"m.heading_note();",
		];

		expect(taken.map((text) => test?.test(text))).toEqual(
			taken.map(() => true),
		);
		expect(left.map((text) => test?.test(text))).toEqual(left.map(() => false));
	});

	it("takes a mapping of key paths to keys.js only where its tail is no key, which names keys.js whole", () => {
		const mappings = [
			{ key: "#i18n/messages/*", targets: [`${outdir}/keys.js`] },
		];
		const names = keyNamesOf("title", holders, mappings, [], []);
		const test = names && textTest(names);

		expect(
			[
				'import { title } from "#i18n/messages/title.js";',
				'import * as all from "#i18n/messages/area/all.js";',
				'import { other } from "#i18n/messages/other.js";',
			].map((text) => test?.test(text)),
		).toEqual([true, true, false]);
	});
});

describe("a reading of the files that may read or reach one key", () => {
	it("reads the files that may read or reach it, and finds what the whole reading finds of it", async () => {
		const dir = projectWith({
			"package.json": JSON.stringify({
				type: "module",
				imports: { "#i18n/messages/*": "./out/keys.js" },
			}),
			"src/a.ts": 'import { m } from "../out/messages.js";\nm.title();\n',
			"src/b.ts":
				'import { other } from "#i18n/messages/other.js";\nother();\n',
			"src/c.ts":
				'import { title } from "#i18n/messages/title.js";\ntitle();\n',
			"src/d.ts":
				'import { m } from "../out/messages.js";\nexport const pick = (k: string) => m[k];\n',
		});

		const whole = await fullReadingIn(dir);
		const one = await fullReadingIn(dir, "title");

		expect(one.read).toEqual(["src/a.ts", "src/c.ts", "src/d.ts"]);
		expect(one.reads.filter((read) => read.endsWith(" title"))).toEqual(
			whole.reads.filter((read) => read.endsWith(" title")),
		);
		expect(one.reaches).toEqual(whole.reaches);
	});
});
