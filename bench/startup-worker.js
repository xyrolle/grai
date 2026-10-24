// Runs inside workerd for startup.mjs: imports the module under test on the first request, then
// renders the sample once cold and once warm, and answers with the times. Under the
// new_module_registry flag a module is compiled when it is first imported, so the time of the
// import holds its parse and compile, as a new process's load does in Node.
import calls from "./calls.js";
import { locale, mode } from "./settings.js";
import { sampleRender } from "./startup-render.mjs";

export default {
	async fetch() {
		const start = performance.now();
		const loaded = await import("./module.mjs");
		const imported = performance.now();
		const render = sampleRender(loaded, mode, calls, locale);
		render();
		const first = performance.now();
		render();
		const warm = performance.now();
		return Response.json({
			load: imported - start,
			first: first - imported,
			warm: warm - first,
		});
	},
};
