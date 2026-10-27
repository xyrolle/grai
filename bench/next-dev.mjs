// Starting `next` in one of the bench's apps (next-apps.mjs), and timing `next dev` until it is
// ready and until the page's first response.
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "./servers.mjs";

export const next = new URL("node_modules/.bin/next", import.meta.url).pathname;
export const nextVersion = JSON.parse(
	readFileSync(new URL("node_modules/next/package.json", import.meta.url)),
).version;
/** Next's environment: no telemetry, which would phone home and outlive the run in a process of its own. */
export const nextEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };

/**
 * Starts `next <command>` in an app on a port the system picks, so that runs side by side never
 * meet, and resolves with the URL it serves once it prints a line matching `ready`.
 */
export function started(root, command, ready) {
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
				resolve(origin);
			}
		};
		child.stdout.on("data", read);
		child.stderr.on("data", read);
	});
	return { child, listening, output: () => output };
}

/** Requests a URL until it answers 200, for at most two minutes; resolves with the time it took. */
async function firstResponse(url) {
	const start = performance.now();
	while (performance.now() - start < 120_000) {
		const response = await fetch(url).catch(() => undefined);
		if (response?.ok) {
			await response.text();
			return performance.now() - start;
		}
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`${url} did not answer in 120 s`);
}

/** `next dev` until it is ready, then until the page's first response: from an empty .next, or not. */
export async function devStart(root, path, { empty }) {
	if (empty) rmSync(join(root, ".next"), { recursive: true, force: true });
	const start = performance.now();
	const server = started(root, "dev", /Ready in/);
	const origin = await server.listening;
	const ready = performance.now() - start;
	const page = await firstResponse(`${origin}${path}`);
	return { server, url: `${origin}${path}`, ready, page };
}
