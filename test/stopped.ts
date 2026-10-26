// Stops a server a test started as the leader of a process group of its own (`detached: true`),
// with every process it forked: SIGTERM first, then SIGKILL for a group still there after
// GRACE_MS, as a server stuck in a request never exits on SIGTERM.
import type { ChildProcess } from "node:child_process";

/** How long a server has to exit on SIGTERM before its group is killed. */
const GRACE_MS = 2000;

/** Signals a process group: false once none of its processes is left. */
function signalled(pid: number, signal: NodeJS.Signals | 0): boolean {
	try {
		process.kill(-pid, signal);
		return true;
	} catch (error) {
		if (error instanceof Error && "code" in error) {
			if (error.code === "ESRCH") return false;
			// macOS refuses a signal to a process that has exited but is not reaped yet, and so to its
			// group, whose other processes still get it.
			if (error.code === "EPERM") return true;
		}
		throw error;
	}
}

/** Resolves once none of the group's processes is left, or after `ms`: whether none is. */
async function gone(pid: number, ms: number): Promise<boolean> {
	const deadline = performance.now() + ms;
	while (signalled(pid, 0)) {
		if (performance.now() > deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	return true;
}

/** Stops a server's whole process group, and resolves once none of its processes is left. */
export async function stopped(server: ChildProcess): Promise<void> {
	const { pid } = server;
	if (pid === undefined) return;
	signalled(pid, "SIGTERM");
	if (await gone(pid, GRACE_MS)) return;
	signalled(pid, "SIGKILL");
	await gone(pid, GRACE_MS);
}
