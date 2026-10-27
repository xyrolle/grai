import {
	readFileSync,
	renameSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { textHash } from "../src/code/facts-cache.ts";
import { FileListing } from "../src/code/listing.ts";
import { projectWith } from "./reading.ts";

/** A listing of a project's `src`, kept in its outdir's state, as a reading lists it. */
function listingOf(dir: string) {
	const listing = new FileListing(join(dir, "out/.grai"), "version");
	const files = listing.list([join(dir, "src")], dir, join(dir, "out"), {
		links: [],
		manifests: [],
		skipped: [],
	});
	listing.save();
	return new Map(files.map((each) => [each.file, each]));
}

/** A file's times set an hour back, as a file last changed long before a command reads it. */
function aged(path: string, seconds = 3_600): void {
	const then = Date.now() / 1_000 - seconds;
	utimesSync(path, then, then);
}

const listingFile = (dir: string) => join(dir, "out/.grai/files");

/**
 * The listing's entry for a file changed as `change` changes it. Setting a file's times back sets
 * its change time to now, which no test can set back, so a test that needs a file changed long
 * before it was read moves the time the listing read it a minute on instead.
 */
function plantedEntry(
	dir: string,
	path: string,
	change: (entry: unknown[]) => void,
): void {
	const kept = JSON.parse(readFileSync(listingFile(dir), "utf8"));
	change(kept.files[path]);
	writeFileSync(listingFile(dir), JSON.stringify(kept));
}

const readLater = (entry: unknown[]) => {
	entry[4] = Date.now() + 60_000;
};

describe("a listing of the sources that knows a file by its stat", () => {
	it("takes a file whose stat is the one kept, and its times a tick older than its reading, as unchanged", () => {
		const dir = projectWith({ "src/a.ts": 'import "./b.ts";\n' });
		const a = join(dir, "src/a.ts");
		aged(a);
		listingOf(dir);
		// What the listing keeps of a.ts, but for another text, which it takes on the stat alone.
		plantedEntry(dir, a, (entry) => {
			readLater(entry);
			entry[5] = "planted";
			entry[7] = ["./planted.ts"];
		});

		const a2 = listingOf(dir).get("src/a.ts");

		expect([a2?.hash, a2?.specifiers]).toEqual(["planted", ["./planted.ts"]]);
		expect(a2?.text).toBe('import "./b.ts";\n');
	});

	it("reads a file again by its content when it changed within a tick of its reading, though its stat is the one kept", () => {
		const dir = projectWith({ "src/a.ts": 'import "./b.ts";\n' });
		const a = join(dir, "src/a.ts");
		listingOf(dir);
		// An edit within the same second, of the same size, whose times the system keeps no finer.
		writeFileSync(a, 'import "./c.ts";\n');
		const stat = statSync(a, { bigint: true });
		plantedEntry(dir, a, (entry) => {
			entry.splice(
				0,
				4,
				String(stat.size),
				String(stat.mtimeNs),
				String(stat.ctimeNs),
				String(stat.ino),
			);
		});

		const a2 = listingOf(dir).get("src/a.ts");

		expect(a2?.hash).toBe(textHash('import "./c.ts";\n'));
		expect(a2?.specifiers).toEqual(["./c.ts"]);
	});

	it("reads a file again after an edit of the same size whose modification time was put back", () => {
		const dir = projectWith({ "src/a.ts": 'import "./b.ts";\n' });
		const a = join(dir, "src/a.ts");
		aged(a);
		listingOf(dir);
		plantedEntry(dir, a, readLater);
		const { atime, mtime } = statSync(a);
		writeFileSync(a, 'import "./c.ts";\n');
		utimesSync(a, atime, mtime);

		expect(listingOf(dir).get("src/a.ts")?.specifiers).toEqual(["./c.ts"]);
	});

	it("reads a file again when another file of the same size and times is renamed over it", () => {
		const dir = projectWith({
			"src/a.ts": 'import "./b.ts";\n',
			"src/next.txt": 'import "./c.ts";\n',
		});
		const a = join(dir, "src/a.ts");
		const next = join(dir, "src/next.txt");
		aged(a);
		aged(next);
		listingOf(dir);
		plantedEntry(dir, a, readLater);
		renameSync(next, a);

		expect(listingOf(dir).get("src/a.ts")?.specifiers).toEqual(["./c.ts"]);
	});

	it("reads a touched file again, keeps its hash, and takes it on its stat after that", () => {
		const dir = projectWith({ "src/a.ts": 'import "./b.ts";\n' });
		const a = join(dir, "src/a.ts");
		aged(a);
		const hash = listingOf(dir).get("src/a.ts")?.hash;
		plantedEntry(dir, a, readLater);
		aged(a, 1_800);

		expect(listingOf(dir).get("src/a.ts")?.hash).toBe(hash);
		// Once its change is a tick older than its reading, a listing that reads nothing again
		// writes nothing, so the same file stays.
		plantedEntry(dir, a, readLater);
		const file = statSync(listingFile(dir)).ino;
		listingOf(dir);
		expect(statSync(listingFile(dir)).ino).toBe(file);
	});
});
