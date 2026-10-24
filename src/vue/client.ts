import { shallowRef } from "vue";

// In dev, a catalog edit renders again, in place, what called a message, and the page keeps its
// state. grai/vite's dev module calls `globalThis[Symbol.for("grai.read")]` in each message call;
// here that is a read of a Vue ref, so every render, computed and watcher that calls a message
// depends on it, and an edit's `grai:change` changes the ref instead of reloading the page.
// Import this once, from the browser's entry. A build defines `import.meta.hot` as undefined, so
// none of it ships.
if (import.meta.hot && typeof window !== "undefined") {
	const edits = shallowRef(0);
	Reflect.set(globalThis, Symbol.for("grai.read"), () => edits.value);
	addEventListener("grai:change", (event) => {
		event.preventDefault();
		edits.value += 1;
	});
}
