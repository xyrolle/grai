// Starting `next` in one of the bench's apps (next-apps.mjs), and timing `next dev` from the
// process's launch: until Next says it is ready, and until the page's first response is complete.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "./servers.mjs";

export const next = new URL("node_modules/.bin/next", import.meta.url).pathname;
export const nextVersion = JSON.parse(
	readFileSync(new URL("node_modules/next/package.json", import.meta.url)),
).version;
/** Next's environment: no telemetry, which would phone home and outlive the run in a process of its own. */
export const nextEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const now = () => performance.timeOrigin + performance.now();

/**
 * Starts `next <command>` in an app on a port the system picks, so that runs side by side never
 * meet. `listening` resolves once Next prints a line matching `ready`, with the URL it serves and
 * the ms since `launched`, the moment before the process was spawned.
 */
export function started(root, command, ready) {
	const launched = now();
	const child = startServer(next, [command, "--port", "0"], {
		cwd: root,
		env: nextEnv,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	const listening = new Promise((resolve, reject) => {
		const deadline = setTimeout(
			() =>
				reject(new Error(`next ${command} was not ready in 120 s:\n${output}`)),
			120_000,
		);
		const read = (chunk) => {
			output += chunk;
			const origin = /- Local:\s+(http:\/\/\S+)/.exec(output)?.[1];
			if (origin !== undefined && ready.test(output)) {
				clearTimeout(deadline);
				resolve({ origin, ready: now() - launched });
			}
		};
		child.stdout.on("data", read);
		child.stderr.on("data", read);
	});
	return { child, launched, listening };
}

/** Requests a URL until it answers 200, for at most two minutes; resolves with its whole body. */
async function firstResponse(url) {
	const start = performance.now();
	while (performance.now() - start < 120_000) {
		const response = await fetch(url).catch(() => undefined);
		if (response?.ok) return response.text();
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`${url} did not answer in 120 s`);
}

/**
 * `next dev` from its launch until it is ready, and until the page's first response is complete:
 * from an empty .next, or not. The server is left running.
 */
export async function devStart(root, path, { empty }) {
	if (empty) rmSync(join(root, ".next"), { recursive: true, force: true });
	const server = started(root, "dev", /Ready in/);
	const { origin, ready } = await server.listening;
	const url = `${origin}${path}`;
	await firstResponse(url);
	return { server, url, ready, page: now() - server.launched };
}
