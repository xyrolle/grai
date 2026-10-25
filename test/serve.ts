// Serves a Worker's module as Bun and Deno run one as it is, `bun <module>` and
// `deno serve <module>`, on a port the system picks and the runtime prints once it listens. Both
// come from the devDependencies, which install them through pnpm's runtime protocol.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export type Runtime = "bun" | "deno";

/** A server of one module, started and stopped as Wrangler's test harness is. */
export type Served = {
	listen(): Promise<void>;
	close(): Promise<void>;
	fetch(path: string, init?: RequestInit): Promise<Response>;
};

/** Each runtime's arguments to serve a module, and the environment it reads its port from. */
const commands: Record<
	Runtime,
	(module: string) => { args: string[]; env: Record<string, string> }
> = {
	bun: (module) => ({ args: [module], env: { PORT: "0" } }),
	deno: (module) => ({ args: ["serve", "--port", "0", module], env: {} }),
};

export function serve(runtime: Runtime, module: string): Served {
	let origin = "";
	let stop = async () => {};
	return {
		async listen() {
			const { args, env } = commands[runtime](module);
			const binary = new URL(
				`../node_modules/.bin/${runtime}`,
				import.meta.url,
			);
			const child = spawn(fileURLToPath(binary), args, {
				env: { ...process.env, ...env },
			});
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

/** The origin of the server `child` starts: the port of the first URL it prints, on loopback. */
function listening(
	runtime: Runtime,
	child: ChildProcessWithoutNullStreams,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let output = "";
		const read = (chunk: Buffer) => {
			output += chunk;
			const port = /http:\/\/[^\s/]+:(\d+)/.exec(output)?.[1];
			if (port !== undefined) resolve(`http://127.0.0.1:${port}`);
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
