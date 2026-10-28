import { once } from "node:events";
import { Worker } from "node:worker_threads";
import { expect, it, onTestFinished } from "vitest";
import { compileCatalogs } from "../src/compilation.ts";
import { parseCatalogs, readProject } from "../src/compile.ts";
import { firstGroups } from "../src/next/first-groups.ts";
import { keyWeights } from "../src/next/key-groups.ts";
import { defaultPageExtensions } from "../src/next/routes.ts";
import { project } from "./project.ts";
import { writeSources } from "./sources.ts";

// The groups of a fresh app's keys read beside the first compile of its `next dev` start
// (`first-groups.ts`): what the read answers, once the compile has written the output its first read
// could not resolve, and what a start takes.

/** A fresh app, its output not written yet: two routes that each read a key, and a key none reads. */
function freshApp() {
	const { dir, config, compile } = project({
		en: { about: "About", home: "Home", unread: "Unread" },
	});
	writeSources(dir, {
		"app/layout.jsx":
			"export default function Layout({ children }) {\n\treturn <html><body>{children}</body></html>;\n}\n",
		"app/page.jsx": `import * as m from "../out/keys.js";\n\nexport default function Page() {\n\treturn <p>{m.home()}</p>;\n}\n`,
		"app/about/page.jsx": `import * as m from "../../out/keys.js";\n\nexport default function About() {\n\treturn <p>{m.about()}</p>;\n}\n`,
	});
	return {
		data: { configFile: config, pageExtensions: [...defaultPageExtensions] },
		/** Compiles the catalogs, writing the output, and gives each key's weight. */
		compiled: async () => {
			expect((await compile()).errors).toEqual([]);
			const read = await readProject(config);
			if ("errors" in read) throw read.errors[0];
			const { catalogs } = parseCatalogs(read.sources);
			return keyWeights(compileCatalogs(read.config, catalogs));
		},
	};
}

it("reads the code before the output is written, then the groups through the output once it is, from each key's weight", async () => {
	const { data, compiled } = freshApp();
	const worker = new Worker(
		new URL("../src/next/group-worker.ts", import.meta.url),
		{ workerData: data, execArgv: [] },
	);
	onTestFinished(async () => {
		await worker.terminate();
	});

	expect(await once(worker, "message")).toEqual(["read"]);
	worker.postMessage(await compiled());

	expect(await once(worker, "message")).toEqual([[["about"], ["home"]]]);
});

it("gives a start no groups when the code is not read by the time its compile is done", async () => {
	const { data, compiled } = freshApp();
	const weights = await compiled();

	expect(await firstGroups(data).after(weights, 60_000)).toBeUndefined();
});
