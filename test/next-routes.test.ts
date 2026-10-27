import {
	mkdirSync,
	mkdtempSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { nextRoutes } from "../src/next/routes.ts";

describe("a Next app's routes", () => {
	it("are its pages and route handlers, each with its segments' files from the root down, and the proxy", () => {
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "grai-routes-")));
		onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
		for (const file of [
			"src/app/layout.tsx",
			"src/app/global-error.tsx",
			"src/app/page.tsx",
			"src/app/(shop)/layout.tsx",
			"src/app/(shop)/cart/loading.tsx",
			"src/app/(shop)/cart/page.tsx",
			"src/app/(shop)/cart/parts.tsx",
			"src/app/_private/page.tsx",
			"src/app/api/route.ts",
			"src/app/notes.md",
			"src/proxy.ts",
		]) {
			mkdirSync(dirname(join(dir, file)), { recursive: true });
			writeFileSync(join(dir, file), "");
		}

		const routes = nextRoutes(dir).map(({ files }) =>
			files.map((file) => relative(join(dir, "src"), file)),
		);

		expect(routes).toEqual([
			["app/page.tsx", "app/global-error.tsx", "app/layout.tsx"],
			[
				"app/(shop)/cart/page.tsx",
				"app/global-error.tsx",
				"app/layout.tsx",
				"app/(shop)/layout.tsx",
				"app/(shop)/cart/loading.tsx",
			],
			["app/api/route.ts", "app/global-error.tsx", "app/layout.tsx"],
			["proxy.ts"],
		]);
	});
});
