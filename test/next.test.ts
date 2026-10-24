import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	PHASE_PRODUCTION_BUILD,
	PHASE_PRODUCTION_SERVER,
} from "next/constants.js";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { withGrai } from "../src/next/config.ts";
import { project } from "./project.ts";

/** Runs from a project's directory, as `next` does, until the test ends. */
function inProject(dir: string): void {
	const before = process.cwd();
	process.chdir(dir);
	onTestFinished(() => process.chdir(before));
}

describe("withGrai", () => {
	it("compiles the catalogs for a build, and resolves the output's name to the outdir beside the app's own names", async () => {
		const { dir } = project({ en: { title: "Your cart" } });
		inProject(dir);

		const config = await withGrai({
			turbopack: { resolveAlias: { "@app": "./app" } },
		})(PHASE_PRODUCTION_BUILD);

		expect(existsSync(join(dir, "out", "messages.js"))).toBe(true);
		expect(config.turbopack?.resolveAlias).toEqual({
			"@app": "./app",
			"grai/next/output/*": "./out/*",
		});
	});

	it("fails a build whose catalogs do not compile, after printing each error", async () => {
		const { dir } = project({ en: { title: "Your cart" }, de: {} });
		inProject(dir);
		const printed = vi.spyOn(console, "error").mockImplementation(() => {});
		onTestFinished(() => printed.mockRestore());

		await expect(withGrai()(PHASE_PRODUCTION_BUILD)).rejects.toThrow(
			"grai: the catalogs did not compile, with 1 error.",
		);
		expect(printed.mock.calls).toEqual([
			[
				'messages/de.json: the catalog has no messages, so de would render nothing. Add its messages, or remove de from "locales".',
			],
			["grai: 1 error"],
		]);
	});

	it("gives a command that bundles nothing, such as next start, the config as it is, without reading grai's", async () => {
		const { dir } = project({ en: { title: "Your cart" } });
		inProject(join(dir, "messages"));
		const nextConfig = { poweredByHeader: false };

		expect(await withGrai(nextConfig)(PHASE_PRODUCTION_SERVER)).toBe(
			nextConfig,
		);
	});
});
