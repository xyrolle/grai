import { fileURLToPath } from "node:url";
import { loadNuxt } from "nuxt/kit";
import { describe, expect, it } from "vitest";
import module from "../src/nuxt/module.ts";
import { project } from "./project.ts";

describe("the module", { timeout: 30_000 }, () => {
	/** Loads Nuxt, from this repository's install, on a project of grai's with the module. */
	const loaded = (
		config: Record<string, unknown>,
		overrides: Record<string, unknown>,
	) =>
		loadNuxt({
			cwd: fileURLToPath(new URL("..", import.meta.url)),
			overrides: {
				rootDir: project({ en: { title: "Your cart" } }, config).dir,
				modules: [module],
				telemetry: false,
				...overrides,
			},
		}).then((nuxt) => nuxt.close());

	it("refuses an app that Nuxt does not render on the server", async () => {
		await expect(loaded({}, { ssr: false })).rejects.toThrow(
			"grai: grai/nuxt renders each page in its request's locale on the server, and Nuxt's ssr is off. Turn it on.",
		);
	});
});
