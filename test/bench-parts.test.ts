// The parts of grai the benches take from the build's entry for them (`graiParts` in
// bench/grai.mjs, `src/bench.ts`), which the gate builds before the tests.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const bench = fileURLToPath(new URL("../bench/", import.meta.url));

/** Every name a bench takes from the parts, as `const { … } = await import(graiParts)` takes it. */
function taken(): string[] {
	return readdirSync(bench)
		.filter((file) => file.endsWith(".mjs"))
		.flatMap((file) =>
			[
				...readFileSync(join(bench, file), "utf8").matchAll(
					/const \{([^{}]*)\}\s*=\s*await import\(graiParts\)/g,
				),
			].flatMap(([, names = ""]) =>
				names
					.split(",")
					.map((name) => name.trim())
					.filter((name) => name !== ""),
			),
		);
}

it("gives the benches every part they take from the build's entry for them", async () => {
	const parts = await import(new URL("../dist/bench.js", import.meta.url).href);
	const names = [...new Set(taken())];

	expect(names.length).toBeGreaterThan(10);
	expect(names.filter((name) => !(name in parts))).toEqual([]);
});
