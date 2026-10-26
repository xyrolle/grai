// Runs inside workerd for startup.mjs: imports the page under test on the first request, then
// renders the sample once cold and once warm, and answers with the times. Under the
// new_module_registry flag a module is compiled when it is first imported, so the time of the
// import holds its parse and compile, as a new process's load does in Node.

import { locale } from "./settings.js";
import values from "./values.js";

export default {
	async fetch() {
		const options = { locale };
		const start = performance.now();
		const { render } = await import("./module.mjs");
		const imported = performance.now();
		render(values, options);
		const first = performance.now();
		render(values, options);
		const warm = performance.now();
		return Response.json({
			load: imported - start,
			first: first - imported,
			warm: warm - first,
		});
	},
};
