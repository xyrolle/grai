import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { recompile } from "../src/compile.ts";
import type { KeyGroups } from "../src/saved-groups.ts";
import { project } from "./project.ts";

// The groups a compile is given to place the keys by (`placing.ts`): taken at once when they have
// come when it asks, taken while it renders the keys by the groups saved if they come meanwhile,
// and never waited for.

const catalogs = { en: { about: "About", home: "Home", title: "Title" } };

/**
 * The groups a compile asked for, given after `turns` turns of the event loop, or never, and
 * whether the compile waits for them.
 */
function given(groups: KeyGroups, turns: number | "never", waited = false) {
	return async () => ({
		groups: new Promise<KeyGroups | undefined>((resolve) => {
			if (turns === "never") return;
			const turn = (left: number) => {
				if (left === 0) resolve(groups);
				else setImmediate(() => turn(left - 1));
			};
			turn(turns);
		}),
		waited,
	});
}

/** The labels of the modules of keys a compile wrote: `g<n>` for a group's, `<n>` for a shard's. */
const modulesIn = (dir: string) =>
	readdirSync(join(dir, "out", "keys"))
		.filter((name) => name.endsWith(".js"))
		.map((name) => name.slice(0, name.indexOf("-")))
		.sort();

it("places the keys by the groups that have come when it asks", async () => {
	const { dir, config } = project(catalogs);
	const { build } = await recompile(config, undefined, {
		placing: given([["about", "home"]], 0),
	});

	expect(build?.rendered.groups).toBe(JSON.stringify([["about", "home"]]));
	expect(modulesIn(dir)).toContain("g0");
});

it("places the keys by the groups that come while it renders them by those saved, rendering them again", async () => {
	const { dir, config } = project(catalogs);
	// The first look comes a turn after the ask, the second a turn after the render: two turns in,
	// the groups come between them.
	const { build } = await recompile(config, undefined, {
		placing: given([["about", "home"]], 2),
	});

	expect(build?.rendered.groups).toBe(JSON.stringify([["about", "home"]]));
	expect(modulesIn(dir)).toContain("g0");
});

it("places the keys by the groups saved, without waiting, when the groups do not come while it renders", async () => {
	const { dir, config } = project(catalogs);
	const { build } = await recompile(config, undefined, {
		placing: given([["about", "home"]], "never"),
	});

	expect(build?.rendered.groups).toBe("[]");
	expect(modulesIn(dir)).not.toContain("g0");
});

it("waits for the groups it is told are close, and renders the keys once, by them", async () => {
	const { dir, config } = project(catalogs);
	const { build } = await recompile(config, undefined, {
		placing: given([["about", "home"]], 5, true),
	});

	expect(build?.rendered.groups).toBe(JSON.stringify([["about", "home"]]));
	expect(modulesIn(dir)).toContain("g0");
});
