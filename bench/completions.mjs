// What one sample of the editor's completions does, whichever language server answers it: it opens
// a project's texts.ts with the marker after its calls and asks for the completions at its end,
// then asks again with nothing changed. Every list must hold exactly the keys the library's types
// give. An engine opens a file with its text and lists the names it completes at an offset.
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The milliseconds of each request of a sample in the project types-projects.mjs described. */
export async function sample(description, engine) {
	const project = JSON.parse(readFileSync(description, "utf8"));
	const keys = new Set(project.keys);
	const path = join(project.directory, project.file);
	const text = `${readFileSync(path, "utf8")}${project.marker}`;
	const times = {};
	const timed = async (step, request) => {
		const start = performance.now();
		const names = await request();
		times[step] = performance.now() - start;
		assertKeys(project.title, keys, names);
	};
	await timed("first", async () => {
		await engine.open(path, text);
		return engine.complete(text.length);
	});
	await timed("next", () => engine.complete(text.length));
	return times;
}

/** Throws unless a completion lists exactly the keys the library's types give, every one of them. */
function assertKeys(title, keys, listed) {
	const names = new Set(listed);
	const missing = [...keys].filter((key) => !names.has(key));
	const extra = [...names].filter((name) => !keys.has(name));
	if (missing.length > 0 || extra.length > 0)
		throw new Error(
			`${title}: the completion misses ${missing.length} of its ${keys.size} keys (${missing.slice(0, 3).join(", ")}) and lists ${extra.length} names that are none (${extra.slice(0, 3).join(", ")})`,
		);
}
