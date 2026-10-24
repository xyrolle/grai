import { GraiError } from "../error.ts";
import { isKeyName } from "../key-checks.ts";

/** A grai key, folded to lower case, and the source keys that become it: the first with its file. */
type Claim = {
	key: string;
	file: string;
	sourceKey: string;
	sourceKeys: Set<string>;
};

/** Names source keys as grai keys, and finds the source keys that would share one. */
export class KeyNames {
	private readonly claims = new Map<string, Claim>();

	/**
	 * A source path's grai key: its segments joined by `_`, every character a JavaScript identifier
	 * cannot hold as `_`, a leading digit after a `_`, and a reserved word followed by one.
	 */
	name(path: readonly string[], sourceKey: string, file: string): string {
		const joined = path.join("_").replace(/[^\w$]/g, "_");
		const identifier = /^\d/.test(joined) ? `_${joined}` : joined;
		const key = isKeyName(identifier) ? identifier : `${identifier}_`;
		const folded = key.toLowerCase();
		const claim = this.claims.get(folded);
		if (claim === undefined) {
			this.claims.set(folded, {
				key,
				file,
				sourceKey,
				sourceKeys: new Set([sourceKey]),
			});
		} else {
			claim.sourceKeys.add(sourceKey);
		}
		return key;
	}

	/** An error for each grai key, ignoring case, that several source keys become. */
	collisions(): GraiError[] {
		return [...this.claims.values()]
			.filter(({ sourceKeys }) => sourceKeys.size > 1)
			.map(
				({ key, file, sourceKey, sourceKeys }) =>
					new GraiError(
						"key-invalid",
						{ file, key: sourceKey },
						`the keys ${[...sourceKeys].join(", ")} all become the grai key ${key}, ignoring case. Rename all but one in the source.`,
					),
			);
	}
}
