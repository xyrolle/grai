// What one sample of the editor's completions does, whichever language server answers it. It opens
// a project's texts.ts with the marker after its calls and asks for the completions at its end;
// asks again with nothing changed; asks for the details of the list's first entry, which an editor
// shows beside it; types two letters of a key and asks; finishes that call and starts another on
// the next line, and asks; and, after the library's tool has written the catalog with a key added,
// asks once more. Each time covers the editor telling the server of the change and the request.
// Every list must hold exactly the keys the library's types give at that point. An engine is
// prepared for a file's project before the sample, as an editor starts its server when a folder
// opens; it opens the file, takes its edits and the files its catalog changed, lists the names it
// completes at an offset, after the character that triggered it if one did, describes the last
// list's first entry, and stops.
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";

/** The milliseconds of each request of a sample in the project types-projects.mjs described. */
export async function sample(description, engine) {
	const project = JSON.parse(readFileSync(description, "utf8"));
	const before = new Set(project.keys.before);
	const path = join(project.directory, project.file);
	const calls = readFileSync(path, "utf8");
	const typed = project.marker.at(-1);
	const times = {};
	const timed = async (step, request) => {
		const start = performance.now();
		const result = await request();
		times[step] = performance.now() - start;
		return result;
	};
	const listed = async (step, keys, request) =>
		assertKeys(project.title, keys, await timed(step, request));
	let text = `${calls}${project.marker}`;
	const edited = (next, trigger) => async () => {
		text = next;
		await engine.change(text);
		return engine.complete(text.length, trigger);
	};
	await engine.prepare(path);
	await listed("first", before, async () => {
		await engine.open(text);
		return engine.complete(text.length, typed);
	});
	await listed("next", before, () => engine.complete(text.length));
	const details = await timed("details", () => engine.details(text.length));
	if (!details)
		throw new Error(`${project.title}: the first entry has no details`);
	await listed("prefix", before, edited(`${text}${project.prefix}`));
	await listed(
		"callSite",
		before,
		edited(`${calls}\n${project.call}${project.marker}`, typed),
	);
	const changes = writeState(project, "after");
	await listed("catalog", new Set(project.keys.after), async () => {
		await engine.changed(changes);
		return engine.complete(text.length);
	});
	await engine.stop();
	return times;
}

/** Every file under a directory, by its path relative to it. */
const filesUnder = (directory) =>
	readdirSync(directory, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => relative(directory, join(entry.parentPath, entry.name)));

/**
 * Writes the project's catalog in a state, `before` or `after`, as a tool that writes only the
 * files whose text changed: the files it created, changed and deleted, by their paths.
 */
export function writeState(project, state) {
	const source = project.states[state];
	const wanted = new Set(filesUnder(source));
	const changes = { created: [], changed: [], deleted: [] };
	for (const top of readdirSync(source)) {
		const target = join(project.directory, top);
		if (!existsSync(target) || !statSync(target).isDirectory()) continue;
		for (const file of filesUnder(target).map((each) => join(top, each))) {
			if (wanted.has(file)) continue;
			rmSync(join(project.directory, file));
			changes.deleted.push(join(project.directory, file));
		}
	}
	for (const file of wanted) {
		const text = readFileSync(join(source, file));
		const target = join(project.directory, file);
		const kind = !existsSync(target)
			? "created"
			: readFileSync(target).equals(text)
				? undefined
				: "changed";
		if (kind === undefined) continue;
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, text);
		changes[kind].push(target);
	}
	return changes;
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
