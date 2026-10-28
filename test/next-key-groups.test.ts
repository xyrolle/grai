import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { members } from "../src/bits.ts";
import { readProjectCode } from "../src/code/project.ts";
import { readingOf } from "../src/code/reads.ts";
import { type Compilation, compileCatalogs } from "../src/compilation.ts";
import { parseCatalogs, readProject } from "../src/compile.ts";
import type { Config } from "../src/config.ts";
import { GraiError } from "../src/error.ts";
import { keyContexts } from "../src/next/key-contexts.ts";
import { keyWeights, nextKeyGroups } from "../src/next/key-groups.ts";
import { nextRoutes } from "../src/next/routes.ts";
import { project } from "./project.ts";
import { writeSources } from "./sources.ts";

/**
 * A Next app's files: a root layout whose navigation reads its keys by a computed name, a home page
 * with a client component it imports, an about page, a component both pages render, and a script
 * no route imports.
 */
const app = {
	"app/layout.jsx": `import * as m from "../out/keys.js";
import { Footer } from "../components/footer.jsx";

export default function Layout({ children }) {
	const section = "home";
	return <html><body><nav>{m[\`nav_\${section}\`]()}</nav><h1>{m.layout_title()}</h1>{children}<Footer /></body></html>;
}
`,
	"app/page.jsx": `import * as m from "../out/keys.js";
import { Cart } from "./cart.jsx";

export default function Page() {
	return <main><h2>{m.home_heading()}</h2><Cart /></main>;
}
`,
	"app/cart.jsx": `"use client";
import * as m from "../out/keys.js";
import { Badge } from "../components/badge.jsx";

export function Cart() {
	return <button>{m.home_button()}<Badge /></button>;
}
`,
	"app/about/page.tsx": `import * as m from "../../out/keys.js";
import type { Shape } from "../../components/types.js";

export default async function About() {
	const { Map } = await import("../../components/map.jsx");
	return <main><h2>{m.about_heading()}</h2><Map /></main>;
}
`,
	"components/footer.jsx": `import * as m from "../out/keys.js";

export function Footer() {
	return <footer>{m.shared_footer()}</footer>;
}
`,
	"components/badge.jsx": `import * as m from "../out/keys.js";

export function Badge() {
	return <span>{m.badge_text()}</span>;
}
`,
	"components/map.jsx": `import * as m from "../out/keys.js";

export function Map() {
	return <figure>{m.map_caption()}</figure>;
}
`,
	"components/types.js": `import * as m from "../out/keys.js";

export const typed = m.typed_only();
`,
	"scripts/seed.js": `import * as m from "../out/keys.js";

console.log(m.seed_only());
`,
};

/** The app's catalog in English, each message its key's words, or `long` for the keys listed. */
function catalog(long: readonly string[] = []) {
	const keys = [
		"about_heading",
		"badge_text",
		"home_button",
		"home_heading",
		"layout_title",
		"map_caption",
		"nav_about",
		"nav_home",
		"seed_only",
		"shared_footer",
		"typed_only",
		"unread",
	];
	return Object.fromEntries(
		keys.map((key) => [key, long.includes(key) ? `${key} `.repeat(2000) : key]),
	);
}

/** An app of these files, its catalog compiled to `out`, and its compilation. */
async function compiledApp(
	long?: readonly string[],
	files: Record<string, string> = app,
	words: Record<string, string> = catalog(long),
) {
	const { dir, config, compile } = project({ en: words });
	writeSources(dir, files);
	expect((await compile()).errors).toEqual([]);
	const read = await readProject(config);
	if ("errors" in read) throw read.errors[0];
	const { catalogs } = parseCatalogs(read.sources);
	return {
		dir,
		config: read.config,
		compilation: compileCatalogs(read.config, catalogs),
	};
}

/** Each read key's contexts in an app, each by its route's page and side, the keys in order. */
async function contextsIn(
	dir: string,
	config: Config,
	compilation: Compilation,
) {
	const code = await readProjectCode(config, [dir], { every: true });
	if (code instanceof GraiError) throw code;
	const routes = nextRoutes(dir);
	const keys = [...compilation.keys.keys()];
	const { of } = await keyContexts(code, await readingOf(code), routes, keys);
	const named = (context: number) =>
		`${relative(join(dir, "app"), routes[context >> 1]?.files[0] ?? "")} ${context % 2 === 0 ? "server" : "client"}`;
	return Object.fromEntries(
		[...of]
			.sort(([a], [b]) => (a < b ? -1 : 1))
			.map(([key, contexts]) => [key, members(contexts).map(named).sort()]),
	);
}

describe("the contexts that read a key", () => {
	it('are the sides of the routes whose modules read it: a server component\'s on the server, past a "use client" module on the client', async () => {
		const { dir, config, compilation } = await compiledApp();

		expect(await contextsIn(dir, config, compilation)).toEqual({
			about_heading: ["about/page.tsx server"],
			badge_text: ["page.jsx client"],
			home_button: ["page.jsx client"],
			home_heading: ["page.jsx server"],
			layout_title: ["about/page.tsx server", "page.jsx server"],
			map_caption: ["about/page.tsx server"],
			nav_about: ["about/page.tsx server", "page.jsx server"],
			nav_home: ["about/page.tsx server", "page.jsx server"],
			shared_footer: ["about/page.tsx server", "page.jsx server"],
		});
	});
});

/**
 * Two routes that take their messages through one barrel of keys, and their client components
 * through one barrel of components, each taking one of what each barrel re-exports.
 */
const barrels = {
	"app/messages.js": 'export { heading_a, heading_b } from "../out/keys.js";\n',
	"app/components.js":
		'export { Hello } from "./hello.jsx";\nexport { Bye } from "./bye.jsx";\n',
	"app/hello.jsx": `"use client";
import * as m from "../out/keys.js";

export function Hello() {
	return <p>{m.hello_text()}</p>;
}
`,
	"app/bye.jsx": `"use client";
import * as m from "../out/keys.js";

export function Bye() {
	return <p>{m.bye_text()}</p>;
}
`,
	"app/layout.jsx":
		"export default function Layout({ children }) {\n\treturn <html><body>{children}</body></html>;\n}\n",
	"app/a/page.jsx": `import { heading_a } from "../messages.js";
import { Hello } from "../components.js";

export default function A() {
	return <main>{heading_a()}<Hello /></main>;
}
`,
	"app/b/page.jsx": `import { heading_b } from "../messages.js";
import { Bye } from "../components.js";

export default function B() {
	return <main>{heading_b()}<Bye /></main>;
}
`,
};
const barrelWords = {
	bye_text: "Bye",
	heading_a: "Heading A ".repeat(2000),
	heading_b: "Heading B ".repeat(2000),
	hello_text: "Hello",
};

describe("the contexts that read a key through a barrel", () => {
	it("are those of the routes that take the key from the barrel, not of every route the barrel reaches; a component barrel's modules, which keep their side effects, reach every route that loads it", async () => {
		const { dir, config, compilation } = await compiledApp(
			[],
			barrels,
			barrelWords,
		);

		expect(await contextsIn(dir, config, compilation)).toEqual({
			bye_text: ["a/page.jsx client", "b/page.jsx client"],
			heading_a: ["a/page.jsx server"],
			heading_b: ["b/page.jsx server"],
			hello_text: ["a/page.jsx client", "b/page.jsx client"],
		});
		expect(await nextKeyGroups(config, keyWeights(compilation))).toEqual([
			["bye_text", "hello_text"],
			["heading_a"],
			["heading_b"],
		]);
	});

	it("follow a component barrel to the components a route takes, when the app's package.json says its modules have no side effects", async () => {
		const { dir, config, compilation } = await compiledApp(
			[],
			barrels,
			barrelWords,
		);
		writeSources(dir, {
			"package.json": JSON.stringify({ type: "module", sideEffects: false }),
		});

		expect(await contextsIn(dir, config, compilation)).toEqual({
			bye_text: ["b/page.jsx client"],
			heading_a: ["a/page.jsx server"],
			heading_b: ["b/page.jsx server"],
			hello_text: ["a/page.jsx client"],
		});
	});
});

/**
 * Two routes that take their keys through a barrel of keys' own paths, and their components
 * through a barrel of `export *`, in an app whose package.json says its modules have no side
 * effects.
 */
const pathAndStarBarrels = {
	"package.json": JSON.stringify({
		type: "module",
		sideEffects: false,
		imports: { "#i18n/messages/*": "./out/keys.js" },
	}),
	"app/paths.js":
		'export { heading_a } from "#i18n/messages/heading_a.js";\nexport { heading_b } from "#i18n/messages/heading_b.js";\n',
	"app/star.js": 'export * from "./hello.jsx";\nexport * from "./bye.jsx";\n',
	"app/servers.js": 'export * from "./sa.jsx";\nexport * from "./sb.jsx";\n',
	"app/sa.jsx": `import * as m from "../out/keys.js";

export function SA() {
	return <p>{m.sa_text()}</p>;
}
`,
	"app/sb.jsx": `import * as m from "../out/keys.js";

export function SB() {
	return <p>{m.sb_text()}</p>;
}
`,
	"app/hello.jsx": barrels["app/hello.jsx"],
	"app/bye.jsx": barrels["app/bye.jsx"],
	"app/layout.jsx": barrels["app/layout.jsx"],
	"app/a/page.jsx": `import { heading_a } from "../paths.js";
import { Hello } from "../star.js";
import { SA } from "../servers.js";

export default function A() {
	return <main>{heading_a()}<SA /><Hello /></main>;
}
`,
	"app/b/page.jsx": `import { heading_b } from "../paths.js";
import { Bye } from "../star.js";
import { SB } from "../servers.js";

export default function B() {
	return <main>{heading_b()}<SB /><Bye /></main>;
}
`,
};

describe("the contexts that read a key through a barrel of paths or of `export *`", () => {
	it("are those of the routes that take the key from a barrel of keys' own paths", async () => {
		const { dir, config, compilation } = await compiledApp(
			[],
			pathAndStarBarrels,
			barrelWords,
		);

		const contexts = await contextsIn(dir, config, compilation);

		expect([contexts.heading_a, contexts.heading_b]).toEqual([
			["a/page.jsx server"],
			["b/page.jsx server"],
		]);
	});

	it("are those of the routes that take a server component an `export *` passes on, when its module exports it, and of every route for a client component's, which the server cannot see into", async () => {
		const { dir, config, compilation } = await compiledApp(
			[],
			pathAndStarBarrels,
			{ ...barrelWords, sa_text: "SA", sb_text: "SB" },
		);

		const contexts = await contextsIn(dir, config, compilation);

		expect([contexts.sa_text, contexts.sb_text]).toEqual([
			["a/page.jsx server"],
			["b/page.jsx server"],
		]);
		// From the server's side a client component's module is a reference whose names Next's
		// bundler does not know, so it keeps every branch of the `export *`, as `next dev` does.
		expect([contexts.hello_text, contexts.bye_text]).toEqual([
			["a/page.jsx client", "b/page.jsx client"],
			["a/page.jsx client", "b/page.jsx client"],
		]);
		expect(await nextKeyGroups(config, keyWeights(compilation))).toEqual([
			["bye_text", "hello_text"],
			["heading_a", "sa_text"],
			["heading_b", "sb_text"],
		]);
	});
});

describe("a Next app's groups of keys", () => {
	it("hold the keys the same routes' sides read, and leave out those no route reads", async () => {
		const large = [
			"about_heading",
			"home_button",
			"home_heading",
			"map_caption",
		];
		const { config, compilation } = await compiledApp(large);

		expect(await nextKeyGroups(config, keyWeights(compilation))).toEqual([
			["about_heading", "map_caption"],
			["badge_text", "home_button"],
			["home_heading"],
			["layout_title", "nav_about", "nav_home", "shared_footer"],
		]);
	});

	it("take a small group into a larger one its routes read anyway, as a module costs more than a few keys", async () => {
		const { config, compilation } = await compiledApp(["home_button"]);

		expect(await nextKeyGroups(config, keyWeights(compilation))).toEqual([
			[
				"about_heading",
				"home_heading",
				"layout_title",
				"map_caption",
				"nav_about",
				"nav_home",
				"shared_footer",
			],
			["badge_text", "home_button"],
		]);
	});
});
