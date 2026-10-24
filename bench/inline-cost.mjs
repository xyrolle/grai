// What inlining messages at their call sites would add to a SvelteKit app's build, measured in a
// copy of the app as it builds today. A client build per locale repeats the client build; copies
// per locale of every client chunk whose code calls a message parse each chunk once and minify
// it once per locale, from the chunk as rendered before minification. It builds the app as
// `vite build` does, with one more plugin that only measures; run it in a copy of the app, never
// in a checkout a dev server serves:
//   cd <app copy> && node <grai>/bench/inline-cost.mjs <locale count>
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const locales = Number(process.argv[2] ?? 3);
const { createBuilder, minifySync, parseSync } = await import(
	pathToFileURL(createRequire(join(root, "package.json")).resolve("vite")).href
);

const callsAMessage = /\bm\.[A-Za-z_$][\w$]*\(/;
const calling = new Set();
const client = { started: 0, built: 0, chunks: 0, calling: 0, copies: 0 };
const measurer = {
	name: "grai-bench-inline-cost",
	applyToEnvironment: (environment) => environment.name === "client",
	buildStart() {
		client.started = performance.now();
	},
	transform: {
		order: "post",
		handler(code, id) {
			if (callsAMessage.test(code)) calling.add(id);
		},
	},
	renderChunk(code, chunk) {
		client.chunks++;
		if (!chunk.moduleIds.some((id) => calling.has(id))) return null;
		const started = performance.now();
		parseSync(chunk.fileName, code);
		for (let copy = 0; copy < locales; copy++) minifySync(chunk.fileName, code);
		client.copies += performance.now() - started;
		client.calling++;
		return null;
	},
	generateBundle() {
		client.built = performance.now();
	},
};

const started = performance.now();
const builder = await createBuilder({ plugins: [measurer], logLevel: "warn" });
await builder.buildApp();
const build = performance.now() - started;
const clientBuild = client.built - client.started - client.copies;
const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
console.log(
	`The build: ${seconds(build - client.copies)}, its client build ${seconds(clientBuild)}, ${client.chunks} client chunks.`,
);
console.log(
	`A client build per locale: ${locales - 1} more client builds, ${seconds((locales - 1) * clientBuild)}; ${locales}× the client chunks, ${locales * client.chunks}.`,
);
console.log(
	`Copies per locale of the ${client.calling} chunks that call a message: ${seconds(client.copies)}, ${locales * client.calling} more files.`,
);
