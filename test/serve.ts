// Serves a Worker's module under Bun and Deno, on 127.0.0.1 alone and a port the system picks, and
// fetches the URL the runtime prints once it listens. On every address, as `bun <module>` and
// `deno serve <module>` listen, another process may hold 127.0.0.1 at that port beside it, which
// macOS allows, and answer in its place. Both runtimes come from the devDependencies, which install
// them through pnpm's runtime protocol.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export type Runtime = "bun" | "deno";

/** A server of one module, started and stopped as Wrangler's test harness is. */
export type Served = {
	listen(): Promise<void>;
	close(): Promise<void>;
	fetch(path: string, init?: RequestInit): Promise<Response>;
};

/** Each runtime's arguments to serve a module on 127.0.0.1 at `port`. */
const commands: Record<Runtime, (module: string, port: number) => string[]> = {
	bun: (module, port) => [
		fileURLToPath(new URL("bun-serve.js", import.meta.url)),
		module,
		String(port),
	],
	deno: (module, port) => [
		"serve",
		"--host",
		"127.0.0.1",
		"--port",
		String(port),
		module,
	],
};

export function serve(runtime: Runtime, module: string, port = 0): Served {
	let origin = "";
	let stop = async () => {};
	return {
		async listen() {
			const args = commands[runtime](module, port);
			const binary = new URL(
				`../node_modules/.bin/${runtime}`,
				import.meta.url,
			);
			const child = spawn(fileURLToPath(binary), args);
			const exited = new Promise((resolve) => child.once("exit", resolve));
			// kill() is false when the process is gone already, or never started.
			stop = async () => {
				if (child.kill()) await exited;
			};
			origin = await listening(runtime, child);
		},
		close: () => stop(),
		fetch: (path, init) => fetch(new URL(path, origin), init),
	};
}

/** The origin of the server `child` starts: the first URL it prints, once its line is whole. */
function listening(
	runtime: Runtime,
	child: ChildProcessWithoutNullStreams,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const read = (chunk: Buffer) => {
			output += chunk;
			const url = /(http:\/\/\S+)\s/.exec(output)?.[1];
			if (url !== undefined) resolve(new URL(url).origin);
		};
		child.stdout.on("data", read);
		child.stderr.on("data", read);
		child.once("error", reject);
		child.once("exit", (code) =>
			reject(
				new Error(`${runtime} exited (${code}) before it listened:\n${output}`),
			),
		);
	});
}
