// Records what a SvelteKit app's browser build ships, for bytes.mjs: each chunk with its imports
// and the modules it holds, the message keys each module names (as `m.key` or by a per-key
// import), and Kit's routes with the nodes they load. Run it in a copy of the app, never in a
// checkout a dev server serves: it builds the app as `vite build` does, with one more plugin that
// only reads.
//   cd <app copy> && node <grai>/bench/record-build.mjs
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const fromApp = (path) => import(pathToFileURL(path).href);
const { createBuilder } = await fromApp(
	createRequire(join(root, "package.json")).resolve("vite"),
);

const chunks = [];
const references = {};
const recorder = {
	name: "grai-bench-recorder",
	transform: {
		order: "post",
		handler(code, id) {
			if (this.environment.name !== "client") return;
			const named = [
				...code.matchAll(/\bm\.([A-Za-z_$][\w$]*)/g),
				...code.matchAll(/paraglide\/messages\/([\w$]+)\.js/g),
			];
			if (named.length > 0)
				references[id] = [...new Set(named.map(([, key]) => key))];
		},
	},
	generateBundle(_, bundle) {
		if (this.environment.name !== "client") return;
		for (const output of Object.values(bundle)) {
			if (output.type !== "chunk") continue;
			chunks.push({
				file: output.fileName,
				facade: output.facadeModuleId,
				imports: output.imports,
				dynamicImports: output.dynamicImports,
				modules: Object.fromEntries(
					Object.entries(output.modules).map(([id, module]) => [
						id,
						module.renderedLength,
					]),
				),
			});
		}
	},
};

const builder = await createBuilder({ plugins: [recorder], logLevel: "warn" });
await builder.buildApp();

const { manifest } = await fromApp(
	join(root, ".svelte-kit/output/server/manifest-full.js"),
);
const routes = manifest.routes
	.filter((route) => route.page)
	.map((route) => ({
		id: route.id,
		nodes: [...route.page.layouts, route.page.leaf].filter(
			(node) => node !== undefined,
		),
	}));
const record = {
	root,
	entry: manifest.client.imports,
	chunks,
	references,
	routes,
};
writeFileSync(join(root, "grai-build.json"), JSON.stringify(record));
console.log(`grai-build.json: ${chunks.length} chunks, ${routes.length} pages`);
