// The servers a bench starts, such as `next dev`, each in a process group of its own, so that
// stopping one stops the processes it forks too. Every group still running is stopped however the
// bench ends: when it stops the server, when it exits or throws, and on a signal.
import { spawn } from "node:child_process";
import { constants } from "node:os";

/** How long a server is given to exit on its own before its group is killed. */
const EXIT_GRACE_MS = 10_000;

/** The process groups of the servers still running, by their leader's pid. */
const groups = new Set();

process.on("exit", () => {
	for (const pid of groups) signalGroup(pid, "SIGKILL");
});
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
	process.on(signal, () => process.exit(128 + constants.signals[signal]));
}

/** Sends a signal to a process group; a group whose processes have all exited is left alone. */
function signalGroup(pid, signal) {
	try {
		process.kill(-pid, signal);
		return true;
	} catch (error) {
		if (error.code === "ESRCH") return false;
		throw error;
	}
}

/** Resolves once no process of the group is left, or after `ms`; with whether it emptied. */
async function emptied(pid, ms) {
	const deadline = performance.now() + ms;
	while (signalGroup(pid, 0)) {
		if (performance.now() > deadline) return false;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return true;
}

/** Spawns a server as the leader of a new process group. */
export function startServer(command, args, options) {
	const child = spawn(command, args, { ...options, detached: true });
	groups.add(child.pid);
	return child;
}

/**
 * Stops a server's whole group: `signal` first, which lets Node write a CPU profile on SIGINT,
 * then SIGKILL for whatever is left after the grace period.
 */
export async function stopServer(child, signal = "SIGTERM") {
	signalGroup(child.pid, signal);
	if (!(await emptied(child.pid, EXIT_GRACE_MS))) {
		signalGroup(child.pid, "SIGKILL");
		await emptied(child.pid, EXIT_GRACE_MS);
	}
	groups.delete(child.pid);
}
