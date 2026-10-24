import { join } from "node:path";
import {
	type DevEnvironment,
	type HotPayload,
	isRunnableDevEnvironment,
	type ViteDevServer,
} from "vite";
import type { Build } from "./compile.ts";
import { patchModule, updateEvent } from "./dev-module.ts";
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

/**
 * The dev server's side: compiles when the server starts and whenever the config or a catalog
 * changes, and nothing else. Each build goes to `compiled`, or the errors of a compile that
 * failed or threw, which the page shows in Vite's overlay until a build succeeds. After an edit,
 * the page gets a patch of the changed keys, or with `reloadOnEdit` reloads; a key added or
 * removed, or a change of locales, reloads it. A server environment that runs its modules in
 * Vite's runner patches its table the same way, so the next server render has the new words
 * without the runner evaluating the program again; any other environment takes the messages
 * again. `close` stops following once the compile under way has finished.
 */
export function serveMessages(
	server: ViteDevServer,
	files: ProjectFiles,
	{ reloadOnEdit }: { reloadOnEdit: boolean },
	compiled: (result: Build | readonly Error[]) => void,
): {
	patch: (id: string) => string | undefined;
	close: () => Promise<void>;
} {
	const client = server.environments.client;
	const patches = new Map<string, string>();
	let previous: Build | undefined;

	const update = async (before: Build, next: Build) => {
		const changed = [...next.compilation.changed];
		if (changed.length === 0) return;
		const environments = Object.values(server.environments);
		const sameExports = changed.every(
			(key) =>
				before.compilation.keys.has(key) && next.compilation.keys.has(key),
		);
		const sameLocales =
			JSON.stringify(before.config.locales) ===
			JSON.stringify(next.config.locales);
		if (!sameExports || !sameLocales) {
			for (const environment of environments)
				await reload(environment, files.keysFile);
			client.hot.send({ type: "full-reload" });
			return;
		}
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
	return { patch: (id) => patches.get(id), close: watcher.close };
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

/** Has an environment take a module again, if it holds it. */
async function reload(environment: DevEnvironment, id: string): Promise<void> {
	const module = environment.moduleGraph.getModuleById(id);
	if (module !== undefined) await environment.reloadModule(module);
}
