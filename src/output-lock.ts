import { randomUUID } from "node:crypto";
import {
	link,
	mkdir,
	readdir,
	readFile,
	unlink,
	writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isMissing } from "./config.ts";
import { GraiError } from "./error.ts";

const lockRetry = 10;
const lockPatience = 30_000;

/** This process's claim in each state directory: a file of its own holding its pid. */
const claims = new Map<string, string>();

/** The compiles of this process that wait for or hold each outdir's lock, in line. */
const lines = new Map<string, Promise<void>>();

/**
 * Takes an outdir's lock, in its state directory: a file holding the writer's pid, linked into
 * place from the writer's claim, so that the lock exists only with its pid in it. A process makes
 * its claim once and its compiles take the lock in turn; a live writer's lock is waited for. A
 * lock whose writer is gone is not taken over, as two writers that each found it so could both
 * take it: the compile fails, and says which file to delete. Returns the lock's release.
 */
export async function lockOutput(state: string): Promise<() => Promise<void>> {
	const before = lines.get(state);
	let leave = () => {};
	const turn = new Promise<void>((resolve) => {
		leave = resolve;
	});
	const line = (before ?? Promise.resolve()).then(() => turn);
	lines.set(state, line);
	const done = () => {
		leave();
		if (lines.get(state) === line) lines.delete(state);
	};
	await before;
	try {
		await takeLock(state);
	} catch (error) {
		done();
		throw error;
	}
	return async () => {
		try {
			await unlink(join(state, "lock"));
		} finally {
			done();
		}
	};
}

async function takeLock(state: string): Promise<void> {
	const path = join(state, "lock");
	const where = { file: join(".grai", "lock") };
	const started = Date.now();
	for (;;) {
		const claim = await claimIn(state);
		const taken = await linked(claim, path);
		if (taken === "taken") return;
		if (taken === "claim gone") {
			claims.delete(state);
			continue;
		}
		const holder = await holderOf(path);
		if (holder === undefined) continue;
		if (!isAlive(holder)) {
			throw new GraiError(
				"output-locked",
				where,
				`the output's lock was left by process ${holder}, which is no longer running, as when a grai is stopped while it writes. If no grai is running, delete ${path} and compile again.`,
			);
		}
		if (Date.now() - started > lockPatience) {
			throw new GraiError(
				"output-locked",
				where,
				`process ${holder} has held the output's lock for ${lockPatience / 1000} s. If no grai is running, delete ${path}.`,
			);
		}
		await delay(lockRetry);
	}
}

/**
 * This process's claim in a state directory, made the first time: `lock.<pid>.<uuid>`, created
 * anew so that no two writers share one, two threads of a process among them. Making it removes
 * the claims of processes no longer running.
 */
async function claimIn(state: string): Promise<string> {
	const made = claims.get(state);
	if (made !== undefined) return made;
	await mkdir(state, { recursive: true });
	await Promise.all(
		(await readdir(state)).map(async (name) => {
			const pid = /^lock\.(\d+)\./.exec(name)?.[1];
			if (pid !== undefined && !isAlive(Number(pid)))
				await unlink(join(state, name)).catch(ignoreMissing);
		}),
	);
	const claim = join(state, `lock.${process.pid}.${randomUUID()}`);
	await writeFile(claim, String(process.pid), { flag: "wx" });
	claims.set(state, claim);
	return claim;
}

/** Links the claim to the lock's path: taken, held by another, or gone with its directory. */
async function linked(
	claim: string,
	path: string,
): Promise<"taken" | "held" | "claim gone"> {
	try {
		await link(claim, path);
		return "taken";
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "EEXIST")
			return "held";
		if (isMissing(error)) return "claim gone";
		throw error;
	}
}

/** The pid a lock holds, or undefined once it is released. */
async function holderOf(path: string): Promise<number | undefined> {
	try {
		return Number(await readFile(path, "utf8"));
	} catch (error) {
		ignoreMissing(error);
		return undefined;
	}
}

function isAlive(pid: number): boolean {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error instanceof Error && "code" in error && error.code === "EPERM";
	}
}

function ignoreMissing(error: unknown): void {
	if (!isMissing(error)) throw error;
}
