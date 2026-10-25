// Runs inside workerd for middleware.mjs: times the server there, as middleware.mjs does in Node.
import { timeServer } from "./middleware-timings.mjs";

export default {
	fetch: async () => Response.json(await timeServer()),
};
