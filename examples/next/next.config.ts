import { withGrai } from "grai/next/config";

// With EXAMPLE_BASE_PATH=/shop, Next serves the app under /shop, the base path grai.base.json names
// too.
const basePath = process.env.EXAMPLE_BASE_PATH;

export default basePath === undefined
	? withGrai()
	: withGrai({ basePath }, { config: "grai.base.json" });
