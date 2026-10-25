import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import { serve } from "./serve.ts";

/** A Worker's module that answers every request with `answer`, removed after the test. */
function workerAnswering(answer: string): string {
	const dir = mkdtempSync(join(tmpdir(), "grai-serve-"));
	onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
	const module = join(dir, "worker.js");
	writeFileSync(
		module,
		`export default { fetch: () => new Response(${JSON.stringify(answer)}) };\n`,
	);
	return module;
}

/** A port another server already holds on 127.0.0.1, answering every request itself. */
async function heldPort(): Promise<number> {
	const holder = createServer((_, response) => {
		response.statusCode = 403;
		response.end("Forbidden");
	});
	await new Promise<void>((resolve) => holder.listen(0, "127.0.0.1", resolve));
	onTestFinished(
		() => new Promise<void>((resolve) => holder.close(() => resolve())),
	);
	const address = holder.address();
	if (address === null || typeof address === "string") {
		throw new Error("the holder has no TCP port");
	}
	return address.port;
}

describe.each(["bun", "deno"] as const)("%s", (runtime) => {
	it("refuses a port another server holds on 127.0.0.1, or is the one that answers on it", async () => {
		const module = workerAnswering("the runtime's own answer");
		const served = serve(runtime, module, await heldPort());
		onTestFinished(() => served.close());

		const answered = await served.listen().then(
			async () => (await served.fetch("/")).text(),
			() => "refused",
		);

		expect(["refused", "the runtime's own answer"]).toContain(answered);
	});
});
