import { join, relative } from "node:path";
import {
	type DevEnvironment,
	type HotPayload,
	isRunnableDevEnvironment,
	type ViteDevServer,
} from "vite";
import type { Build } from "./compile.ts";
import { patchedEvent, updateEvent } from "./dev-events.ts";
import { missingKeyModule, patchModule } from "./dev-module.ts";
import { messagesOf } from "./error.ts";
import { watch } from "./watch.ts";

/** Where a project's grai files are, for the plugin. */
export type ProjectFiles = {
	configFile: string;
	outdir: string;
	keysFile: string;
};

/**
 * The id keys.js goes by in dev, where the plugin serves it from memory: not the path of the file
 * the compile writes for Node and TypeScript. Vite's module graph ties a module to the file of its
 * id, and its watcher takes each write of that file, which every compile makes, for a change of the
 * module: it would mark keys.js and every importer changed, and the server's runner would evaluate
 * the program again on its next render, where the plugin patches it in place.
 */
export const devKeysId = "\0grai:keys";

/** How the page imports an edit's patch, and that module's id. */
export const patchPrefix = "grai:patch/";
/** The id of the module a per-key import of a key no catalog has resolves to. */
const missingKeyPrefix = "\0grai:missing-key/";

/**
 * The dev server's side: compiles when the server starts and whenever the config or a catalog
 * changes, and nothing else. Each build goes to `compiled`, or the errors of a compile that
 * failed or threw, which the page shows in Vite's overlay until a build succeeds. After an edit,
 * the page gets a patch of the changed keys, or with `reloadOnEdit` reloads; a key added or
 * removed, one turned from text into markup or back, or a new runtime (another config for it to
 * read, or another grai), reloads it. A patch imports the plural rules and formatters by their
 * names in the edit's build, so it reaches them when an edit renames them. A
 * server environment that runs its modules in Vite's runner patches its table the same way, so
 * the next server render has the new words without the runner evaluating the program again; any
 * other environment takes the messages again. Once a server has the edit, the page is told
 * (`grai:patched`), so its loads can run again. A per-key import of a key no catalog has gets a
 * module whose export throws when called (`missingKeyImport`), so the page still loads. `close`
 * stops following once the compile under way has finished.
 */
export function serveMessages(
	server: ViteDevServer,
	files: ProjectFiles,
	{ reloadOnEdit }: { reloadOnEdit: boolean },
	compiled: (result: Build | readonly Error[]) => void,
): {
	module: (id: string) => string | undefined;
	missingKeyImport: (key: string, importer: string) => string | undefined;
	close: () => Promise<void>;
} {
	const client = server.environments.client;
	const patches = new Map<string, string>();
	/** Each key imported by its path, with the modules that import it so. */
	const importers = new Map<string, Set<string>>();
	let previous: Build | undefined;
	/** The page's word that a server has an edit, from its runner or once it takes the messages again. */
	const patched: HotPayload = { type: "custom", event: patchedEvent };
	for (const environment of Object.values(server.environments)) {
		if (environment !== client)
			environment.hot.on(patchedEvent, () => client.hot.send(patched));
	}

	const update = async (before: Build, next: Build) => {
		const changed = [...next.compilation.changed];
		// A change of config or of grai rewrites the runtime's anchor: a page that took the new
		// runtime beside the old would hold two, each with its own locale.
		const anchor = before.rendered.modules.runtime;
		const sameRuntime =
			before.rendered.files.get(anchor) === next.rendered.files.get(anchor);
		if (changed.length === 0 && sameRuntime) return;
		const environments = Object.values(server.environments);
		// A patch writes a key's new variants into the table, under the export made when the module
		// was evaluated: it reaches a key called the same way, and a key turned from text into markup,
		// or back, needs an export with its parts, or without them.
		const sameCalls = changed.every((key) => {
			const was = before.compilation.keys.get(key);
			const is = next.compilation.keys.get(key);
			return (
				was !== undefined &&
				is !== undefined &&
				(was.kind === "markup") === (is.kind === "markup")
			);
		});
		if (!sameCalls || !sameRuntime) {
			const reimporting = [...importers]
				.filter(
					([key]) =>
						before.compilation.keys.has(key) !== next.compilation.keys.has(key),
				)
				.flatMap(([, modules]) => [...modules]);
			const runtime = sameRuntime ? [] : [join(files.outdir, anchor)];
			for (const environment of environments) {
				for (const id of [devKeysId, ...runtime, ...reimporting])
					await reload(environment, id);
			}
			client.hot.send({ type: "full-reload" });
			return;
		}
		const id = `${patchPrefix}${patches.size}`;
		patches.set(`\0${id}`, patchModule(files.outdir, next, changed));
		// A runner imports the patch by its id, a page under the dev server's base, which Nuxt's is
		// `/_nuxt/`.
		const patchAt = (base: string): HotPayload => ({
			type: "custom",
			event: updateEvent,
			data: { url: `${base}@id/__x00__${id}` },
		});
		const patch = patchAt("/");
		for (const environment of environments) {
			if (environment === client) continue;
			if (!isRunnableDevEnvironment(environment)) {
				await reload(environment, devKeysId);
				client.hot.send(patched);
				continue;
			}
			// A runner keeps the module it evaluated, which the patch updates: dropping only the
			// module's code has a later evaluation take the edit, where invalidating it would evaluate
			// every importer again.
			const module = environment.moduleGraph.getModuleById(devKeysId);
			if (module !== undefined)
				environment.moduleGraph.updateModuleTransformResult(module, null);
			environment.hot.send(patch);
		}
		// The pages last, after the servers are sent the patch. A module loaded after the edit takes
		// it afresh, with the edit in it.
		const module = client.moduleGraph.getModuleById(devKeysId);
		if (module !== undefined) client.moduleGraph.invalidateModule(module);
		client.hot.send(
			reloadOnEdit ? { type: "full-reload" } : patchAt(server.config.base),
		);
	};

	/** Shows what went wrong in the server's log and the page's overlay. */
	let showing = false;
	const shown = (message: string, stack = "") => {
		server.config.logger.error(`grai: ${message}`);
		client.hot.send({
			type: "error",
			err: { message, stack, plugin: "grai" },
		});
		showing = true;
	};
	/**
	 * Takes an error shown before down, from the open pages and from the page that connects next:
	 * Vite's client takes its overlay down on an update, and while no page is open Vite's server
	 * keeps the last error, or reload, for the next page to connect.
	 */
	const cleared = () => {
		if (!showing) return;
		showing = false;
		client.hot.send({ type: "update", updates: [] });
		if (server.ws.clients.size === 0) client.hot.send({ type: "full-reload" });
	};
	/**
	 * Tells every environment's plugins that the output's modules were created, as Vite's watcher
	 * does once it reports them. A page that imported the output while a compile failed left Vite's
	 * resolver a lookup that found nothing, and the page reloads before the watcher catches up.
	 */
	const created = (build: Build) =>
		Promise.all(
			Object.values(server.environments).flatMap((environment) =>
				[...build.rendered.files.keys()]
					.filter((file) => file.endsWith(".js"))
					.map((file) =>
						environment.pluginContainer.watchChange(join(files.outdir, file), {
							event: "create",
						}),
					),
			),
		);
	/** A compile or an update that threw, as when the outdir cannot be written. */
	const failed = (thrown: unknown) => {
		const error = thrown instanceof Error ? thrown : new Error(String(thrown));
		compiled([error]);
		shown(error.message, error.stack);
	};

	const watcher = watch(
		files.configFile,
		(result, _milliseconds, next) => {
			if (next === undefined) {
				compiled(result.errors);
				shown(messagesOf(result.errors));
				return;
			}
			const before = previous;
			previous = next;
			compiled(next);
			if (before === undefined && showing) {
				// The first output comes after a failed compile: Vite learns of it before the page reloads.
				created(next).then(cleared, failed);
				return;
			}
			cleared();
			if (before !== undefined) update(before, next).catch(failed);
		},
		failed,
	);
	/**
	 * The id a per-key import resolves to when the build lacks its key: a module whose export throws
	 * when called, with the import shown in the overlay. Undefined while the build has the key, which
	 * keys.js exports. The importer is kept either way, so that a build adding or removing the key
	 * has it resolve the key again.
	 */
	const missingKeyImport = (key: string, importer: string) => {
		importers.set(key, (importers.get(key) ?? new Set()).add(importer));
		if (previous === undefined || previous.compilation.keys.has(key)) {
			return undefined;
		}
		shown(
			`${relative(server.config.root, importer)} imports "${key}" by its path, but no catalog has it. Add it to every catalog, or fix the import.`,
		);
		return `${missingKeyPrefix}${key}`;
	};
	const module = (id: string) =>
		id.startsWith(missingKeyPrefix)
			? missingKeyModule(files.outdir, id.slice(missingKeyPrefix.length))
			: patches.get(id);
	return { module, missingKeyImport, close: watcher.close };
}

/** Whether a file is the plugin's to follow, so Vite's own update leaves it alone. */
export function followedFile(
	files: ProjectFiles,
	build: Build | undefined,
	file: string,
): boolean {
	const catalogs = [...(build?.config.catalogs.values() ?? [])].flat();
	return (
		file === files.configFile ||
		file.startsWith(`${files.outdir}/`) ||
		catalogs.includes(file)
	);
}

/** The key a per-key path names by its last segment, `…/<key>.js`, if the build has that key. */
export function pathKey(build: Build, id: string): string | undefined {
	const key = /([^/]+)\.js$/.exec(id)?.[1];
	return key !== undefined && build.compilation.keys.has(key) ? key : undefined;
}

/** A key's own module in dev: the key, from keys.js, so an edit's patch still reaches it. */
export function keyFromKeys(files: ProjectFiles, key: string): string {
	return `export { ${key} } from ${JSON.stringify(files.keysFile)};\n`;
}

/** Has an environment take a module again, if it holds it. */
async function reload(environment: DevEnvironment, id: string): Promise<void> {
	const module = environment.moduleGraph.getModuleById(id);
	if (module !== undefined) await environment.reloadModule(module);
}
