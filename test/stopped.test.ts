import { spawn } from "node:child_process";
import { expect, it } from "vitest";
import { stopped } from "./stopped.ts";

/** A server that ignores SIGTERM, as one stuck in a request does, and has forked one that does too. */
const stubborn = `process.on("SIGTERM", () => {});
const forked = require("node:child_process").spawn(process.execPath, ["-e", 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: "ignore" });
console.log(forked.pid);
setInterval(() => {}, 1000);`;

it("stops a server's group that does not exit on SIGTERM, the process it forked included", async () => {
	const server = spawn(process.execPath, ["-e", stubborn], { detached: true });
	const forked = await new Promise<number>((resolve) =>
		server.stdout.once("data", (chunk) => resolve(Number(String(chunk)))),
	);
	const group = server.pid ?? 0;

	await stopped(server);

	expect(() => process.kill(-group, 0)).toThrow(/ESRCH/);
	expect(() => process.kill(forked, 0)).toThrow(/ESRCH/);
});
