import { join, relative } from "node:path";
import {
	type DevEnvironment,
	type HotPayload,
	isRunnableDevEnvironment,
	type ViteDevServer,
} from "vite";
import type { Build } from "./compile.ts";
import { missingKeyModule, patchModule, updateEvent } from "./dev-module.ts";
import { messagesOf } from "./error.ts";
import { watch } from "./watch.ts";

/** Where a project's grai files are, for the plugin. */
export type ProjectFiles = {
	configFile: string;
	outdir: string;
	keysFile: string;
};

/** How the page imports an edit's patch, and that module's id. */
export const patchPrefix = "grai:patch/";
/** The id of the module a per-key import of a key no catalog has resolves to. */
const missingKeyPrefix = "\0grai:missing-key/";

/**
 * The dev server's side: compiles when the server starts and whenever the config or a catalog
 * changes, and nothing else. Each build goes to `compiled`, or the errors of a compile that
 * failed or threw, which the page shows in Vite's overlay until a build succeeds. After an edit,
 * the page gets a patch of the changed keys, or with `reloadOnEdit` reloads. An edit that adds or
 * removes a key or its markup, or rewrites a module the table imports (`tableImports`), reloads it
 * with those modules taken again. A server environment that runs its modules in
 * Vite's runner patches its table the same way, so the next server render has the new words
 * without the runner evaluating the program again; any other environment takes the messages
 * again. A per-key import of a key no catalog has gets a module whose export throws when called
 * (`missingKeyImport`), so the page still loads. `close` stops following once the compile under
 * way has finished.
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

	const update = async (before: Build, next: Build) => {
		const changed = [...next.compilation.changed];
		const environments = Object.values(server.environments);
		const rewritten = changedModules(before, next);
		if (rewritten.length > 0 || !sameCalls(before, next, changed)) {
			const reimporting = [...importers]
				.filter(
					([key]) =>
						before.compilation.keys.has(key) !== next.compilation.keys.has(key),
				)
				.flatMap(([, modules]) => [...modules]);
			const ids = [
				files.keysFile,
				...rewritten.map((file) => join(files.outdir, file)),
				...reimporting,
			];
			for (const environment of environments) {
				for (const id of ids) await reload(environment, id);
			}
			client.hot.send({ type: "full-reload" });
			return;
		}
		if (changed.length === 0) return;
		const id = `${patchPrefix}${patches.size}`;
		patches.set(`\0${id}`, patchModule(files.outdir, next, changed));
		const patch: HotPayload = {
			type: "custom",
			event: updateEvent,
			data: { url: `/@id/__x00__${id}` },
		};
		for (const environment of environments) {
			if (environment === client) continue;
			if (!isRunnableDevEnvironment(environment)) {
				await reload(environment, files.keysFile);
				continue;
			}
			// A runner keeps the module it evaluated, which the patch updates: dropping only the
			// module's code has a later evaluation take the edit, where invalidating it would evaluate
			// every importer again.
			const module = environment.moduleGraph.getModuleById(files.keysFile);
			if (module !== undefined)
				environment.moduleGraph.updateModuleTransformResult(module, null);
			environment.hot.send(patch);
		}
		// The pages last, after the servers are sent the patch. A module loaded after the edit takes
		// it afresh, with the edit in it.
		const module = client.moduleGraph.getModuleById(files.keysFile);
		if (module !== undefined) client.moduleGraph.invalidateModule(module);
		client.hot.send(reloadOnEdit ? { type: "full-reload" } : patch);
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
	const catalogs = [...(build?.config.catalogs.values() ?? [])];
	return (
		file === files.configFile ||
		file.startsWith(`${files.outdir}/`) ||
		catalogs.includes(file)
	);
}

/**
 * The modules of the output that the dev table's keys import, or that the runtime reads as it
 * loads: an edit that rewrites one changes what a loaded module exports or holds, which no patch of
 * the table can bring.
 */
const tableImports = ["config.js", "plurals.js", "formats.js"];

/** The modules of `tableImports` an edit rewrote. */
function changedModules(before: Build, next: Build): string[] {
	return tableImports.filter(
		(file) => before.rendered.files.get(file) !== next.rendered.files.get(file),
	);
}

/**
 * Whether every changed key was there before, is there still and is called as before: markup has
 * `.parts()` and any other message has not, and the table's exports keep the shape they loaded with.
 */
function sameCalls(
	before: Build,
	next: Build,
	changed: readonly string[],
): boolean {
	return changed.every((key) => {
		const was = before.compilation.keys.get(key);
		const is = next.compilation.keys.get(key);
		return (
			was !== undefined &&
			is !== undefined &&
			(was.kind === "markup") === (is.kind === "markup")
		);
	});
}

/** Has an environment take a module again, if it holds it. */
async function reload(environment: DevEnvironment, id: string): Promise<void> {
	const module = environment.moduleGraph.getModuleById(id);
	if (module !== undefined) await environment.reloadModule(module);
}
