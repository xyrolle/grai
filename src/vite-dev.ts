import type { DevEnvironment, ViteDevServer } from "vite";
import type { Build } from "./compile.ts";
import { patchModule, updateEvent } from "./dev-module.ts";
import { type GraiError, messagesOf } from "./error.ts";
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
 * failed, which the page shows in Vite's overlay. After an edit, the page gets a patch of the
 * changed keys; a key added or removed, or a change of locales, reloads it. The server's other
 * environments take the messages again, so the next server render has the new words. `close`
 * stops following once the compile under way has finished.
 */
export function serveMessages(
	server: ViteDevServer,
	files: ProjectFiles,
	compiled: (result: Build | readonly GraiError[]) => void,
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
		for (const environment of Object.values(server.environments)) {
			if (environment !== client) await reload(environment, files.keysFile);
		}
		const sameExports = changed.every(
			(key) =>
				before.compilation.keys.has(key) && next.compilation.keys.has(key),
		);
		const sameLocales =
			JSON.stringify(before.config.locales) ===
			JSON.stringify(next.config.locales);
		if (!sameExports || !sameLocales) {
			await reload(client, files.keysFile);
			client.hot.send({ type: "full-reload" });
			return;
		}
		// A page loaded after the edit takes the module afresh, with the edit in it.
		const module = client.moduleGraph.getModuleById(files.keysFile);
		if (module !== undefined) client.moduleGraph.invalidateModule(module);
		const id = `${patchPrefix}${patches.size}`;
		patches.set(`\0${id}`, patchModule(files.outdir, next, changed));
		client.hot.send({
			type: "custom",
			event: updateEvent,
			data: { url: `/@id/__x00__${id}` },
		});
	};

	/** Shows what went wrong in the server's log and the page's overlay. */
	const shown = (message: string, stack = "") => {
		server.config.logger.error(`grai: ${message}`);
		client.hot.send({
			type: "error",
			err: { message, stack, plugin: "grai" },
		});
	};
	/** A compile or an update that threw, as when the outdir cannot be written. */
	const failed = (error: unknown) =>
		error instanceof Error
			? shown(error.message, error.stack)
			: shown(String(error));

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
