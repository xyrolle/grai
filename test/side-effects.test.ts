import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";
import { expect, it } from "vitest";

/** A bundle of a module of the built package imported for its effects alone, as an app imports it. */
async function importedForEffects(file: string): Promise<string> {
	const path = fileURLToPath(new URL(`../dist/${file}`, import.meta.url));
	const bundle = await rolldown({
		input: "entry",
		plugins: [
			{
				name: "entry",
				resolveId: (id) => (id === "entry" ? id : null),
				load: (id) =>
					id === "entry" ? `import ${JSON.stringify(path)};\n` : null,
			},
		],
		external: (id) => id !== "entry" && !id.startsWith(".") && !isAbsolute(id),
		logLevel: "silent",
	});
	const { output } = await bundle.generate({ format: "esm" });
	await bundle.close();
	return output
		.map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
		.join("")
		.trim();
}

it("keeps a module the package marks as having effects when it is imported for them alone", async () => {
	for (const file of [
		"register.js",
		"next/render.js",
		"next/provider.js",
		"nuxt/runtime/plugin.js",
	]) {
		expect(await importedForEffects(file), file).not.toBe("");
	}
	// A module without effects, imported for none of its exports, is left out.
	expect(await importedForEffects("vite.js")).toBe("");
});
