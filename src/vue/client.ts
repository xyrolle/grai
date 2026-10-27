import { type ShallowRef, shallowRef } from "vue";
import { changeEvent, readHook } from "../dev-events.ts";

declare global {
	interface WindowEventMap {
		[changeEvent]: CustomEvent<{ keys: readonly string[] }>;
	}
}

// In dev, a catalog edit renders again, in place, what called an edited message, and the page
// keeps its state. @xyrolle/grai/vite's dev module names each message call's key to `grai.read`;
// here that is a read of the key's Vue ref, so a render, computed or watcher that calls a message
// depends on its key, and an edit's `grai:change` changes the edited keys' refs instead of
// reloading the page. Import this once, from the browser's entry. A build defines `import.meta.hot`
// as undefined, so none of it ships.
if (import.meta.hot && typeof window !== "undefined") {
	const edits = new Map<string, ShallowRef<number>>();
	const editsOf = (key: string): ShallowRef<number> => {
		let found = edits.get(key);
		if (found === undefined) {
			found = shallowRef(0);
			edits.set(key, found);
		}
		return found;
	};
	Object.defineProperty(globalThis, Symbol.for(readHook), {
		value: (key: string) => editsOf(key).value,
	});
	addEventListener(changeEvent, (event) => {
		event.preventDefault();
		for (const key of event.detail.keys) {
			const edited = edits.get(key);
			if (edited !== undefined) edited.value += 1;
		}
	});
}
