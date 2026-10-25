import { createSubscriber } from "svelte/reactivity";
import { dev } from "$app/env";
import { refreshAll } from "$app/navigation";
import { changeEvent, patchedEvent, readHook } from "./dev-events.ts";

declare global {
	interface WindowEventMap {
		[changeEvent]: CustomEvent<{ keys: readonly string[] }>;
	}
}

/** The renders that read one key: `read` subscribes the one that calls it, `edited` reruns them. */
class Readers {
	#rerun = () => {};
	read = createSubscriber((rerun) => {
		this.#rerun = rerun;
		return () => {
			this.#rerun = () => {};
		};
	});
	edited(): void {
		this.#rerun();
	}
}

// In dev, a catalog edit draws the text it changed again, in place, and the page keeps its state.
// Each message call names its key to `grai.read`, which subscribes the render that made it to that
// key, so an edit reruns only the renders that read an edited key, and reloads nothing. The page's
// loads and remote functions run again too, for the text they return, once the server says it has
// the edit: on the dev server's own event, as a page whose text all comes from the server holds no
// module of messages to tell it.
// Import it once, from `src/hooks.client.ts`; a build leaves it out.
if (dev) {
	const readers = new Map<string, Readers>();
	const readersOf = (key: string): Readers => {
		let found = readers.get(key);
		if (found === undefined) {
			found = new Readers();
			readers.set(key, found);
		}
		return found;
	};
	Object.defineProperty(globalThis, Symbol.for(readHook), {
		value: (key: string) => readersOf(key).read(),
	});
	addEventListener(changeEvent, (event) => {
		event.preventDefault();
		for (const key of event.detail.keys) readers.get(key)?.edited();
	});
	import.meta.hot?.on(patchedEvent, () => void refreshAll());
}
