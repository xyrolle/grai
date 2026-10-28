import { expect } from "vitest";
import { compileCatalogs } from "../src/compilation.ts";
import { parseCatalogs, readProject } from "../src/compile.ts";
import type { AppData } from "../src/next/app-data.ts";
import { keyWeights } from "../src/next/key-weights.ts";
import { defaultPageExtensions } from "../src/next/routes.ts";
import { project } from "./project.ts";
import { writeSources } from "./sources.ts";

/**
 * A fresh Next app, its output not written yet: two routes that each read a key, and keys none
 * reads, `unread` and `more` others. It gives the data withGrai hands its threads, and each key's
 * weight, from a compile of its catalogs that writes the output or from one that does not.
 */
export function freshApp(more = 0): {
	dir: string;
	config: string;
	data: AppData;
	compiled: () => Promise<Map<string, number>>;
	weights: () => Promise<Map<string, number>>;
} {
	const others = Object.fromEntries(
		Array.from({ length: more }, (_, index) => [`key${index}`, `Key ${index}`]),
	);
	const { dir, config, compile } = project({
		en: { about: "About", home: "Home", unread: "Unread", ...others },
	});
	writeSources(dir, {
		"app/layout.jsx":
			"export default function Layout({ children }) {\n\treturn <html><body>{children}</body></html>;\n}\n",
		"app/page.jsx": `import * as m from "../out/keys.js";\n\nexport default function Page() {\n\treturn <p>{m.home()}</p>;\n}\n`,
		"app/about/page.jsx": `import * as m from "../../out/keys.js";\n\nexport default function About() {\n\treturn <p>{m.about()}</p>;\n}\n`,
	});
	/** Each key's weight, from its catalogs compiled without writing the output. */
	const weights = async (): Promise<Map<string, number>> => {
		const read = await readProject(config);
		if ("errors" in read) throw read.errors[0];
		const { catalogs } = parseCatalogs(read.sources);
		return keyWeights(compileCatalogs(read.config, catalogs));
	};
	return {
		dir,
		config,
		data: { configFile: config, pageExtensions: [...defaultPageExtensions] },
		compiled: async () => {
			expect((await compile()).errors).toEqual([]);
			return weights();
		},
		weights,
	};
}
