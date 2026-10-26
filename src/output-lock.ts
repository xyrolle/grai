import { randomUUID } from "node:crypto";
import {
	link,
	mkdir,
	readdir,
	readFile,
	unlink,
	writeFile,
} from "node:fs/promises";
import { basename, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { isMissing } from "./config.ts";
import { GraiError } from "./error.ts";

const lockRetry = 10;
const lockPatience = 30_000;

/** This process's claim in each state directory: a file of its own holding its pid and an id. */
const claims = new Map<string, string>();

/** The compiles of this process that wait for or hold each outdir's lock, in line. */
const lines = new Map<string, Promise<void>>();

/**
 * Takes an outdir's lock, in its state directory: a file holding the writer's pid and the id of its
 * claim, linked into place from the claim, so that the lock exists only with them in it. A process
 * makes its claim once and its compiles take the lock in turn. A lock whose writer is gone, as one
 * killed while it wrote, is removed (`removeDead`) and taken. A live writer's lock is waited for, as
 * is a live writer's takeover of a dead one's, each `lockPatience` at most: the compile then fails
 * and names the file to delete. Returns the lock's release.
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
		const waiting = isAlive(holder.pid)
			? { file: path, pid: holder.pid }
			: await removeDead(path, holder, claim);
		if (waiting === undefined) continue;
		if (Date.now() - started > lockPatience) {
			const waited =
				waiting.file === path
					? "has held the output's lock"
					: "has been taking over the output's lock, left by a process no longer running,";
			throw new GraiError(
				"output-locked",
				{ file: join(".grai", basename(waiting.file)) },
				`process ${waiting.pid} ${waited} for ${lockPatience / 1000} s. If no grai is running, delete ${waiting.file}.`,
			);
		}
		await delay(lockRetry);
	}
}

/** A live writer a compile waits for, and the file it holds: the lock, or a takeover of it. */
type Waiting = { file: string; pid: number };

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
	const id = randomUUID();
	const claim = join(state, `lock.${process.pid}.${id}`);
	await writeFile(claim, `${process.pid} ${id}`, { flag: "wx" });
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

/**
 * Removes a file a writer that is gone holds, as its claim linked into place: the lock, or a
 * takeover of one. Its remover first links its own claim to `<file>.taking.<the holder's id>`,
 * which one writer can and the others then find taken, and removes the file only while it still
 * holds that holder's id. No other writer removes the file meanwhile, as each would need the same
 * takeover, so the remover never removes a lock another writer took after the dead one. A takeover
 * whose remover is gone in turn is removed the same way first. Returns the live writer whose
 * takeover there is to wait for, as a live writer's lock is waited for, or undefined once the file
 * is removed.
 */
async function removeDead(
	file: string,
	holder: Holder,
	claim: string,
): Promise<Waiting | undefined> {
	const takeover = `${file}.taking.${holder.id}`;
	for (;;) {
		const taken = await linked(claim, takeover);
		if (taken === "taken") break;
		if (taken === "claim gone") return undefined;
		const remover = await holderOf(takeover);
		if (remover === undefined) continue;
		if (isAlive(remover.pid)) return { file: takeover, pid: remover.pid };
		const waiting = await removeDead(takeover, remover, claim);
		if (waiting !== undefined) return waiting;
	}
	try {
		if ((await holderOf(file))?.id === holder.id)
			await unlink(file).catch(ignoreMissing);
	} finally {
		await unlink(takeover).catch(ignoreMissing);
	}
	return undefined;
}

/** Who holds a lock: the pid of its writer and the id of the writer's claim. */
type Holder = { pid: number; id: string };

/** Who holds a lock or a takeover, or undefined once it is released. */
async function holderOf(path: string): Promise<Holder | undefined> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (error) {
		ignoreMissing(error);
		return undefined;
	}
	const [pid = "", id = text] = text.split(" ");
	// A file name of the id: what a lock written by hand holds is not a claim's.
	return { pid: Number(pid), id: id.replace(/[^\w-]/g, "_") };
}

/** Whether a process is running, as one whose signal the system refuses to send is. */
export function isAlive(pid: number): boolean {
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
