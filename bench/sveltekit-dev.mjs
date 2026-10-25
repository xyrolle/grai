// Dev, in SvelteKit: one message edited until the open page shows it, end to end, in the example
// app (examples/sveltekit) under `vite dev`: the catalog written, grai/vite's watcher and patch,
// the socket, the page, Svelte's render. "in place" is the page with grai/sveltekit/client, which
// draws the edit again; "reload" stops that module from hearing the edit, so the page reloads, as
// it did before it. Each edit gives the Romanian greeting new text and waits for the heading to show
// it; the times include the browser driver's own round trip. The catalog is put back at the end.
//   node sveltekit-dev.mjs
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORT = 4753;
const EDITS = 15;
const example = new URL("../examples/sveltekit/", import.meta.url).pathname;
const catalogFile = join(example, "messages/ro.json");

/** Starts the example's dev server, resolving once it listens. */
function devServer() {
	const server = spawn(
		join(example, "node_modules/.bin/vite"),
		["dev", "--port", String(PORT), "--strictPort"],
		{ cwd: example },
	);
	return new Promise((resolve, reject) => {
		server.stdout.on("data", (chunk) => {
			if (String(chunk).includes(`localhost:${PORT}`)) resolve(server);
		});
		server.on("exit", (code) => reject(new Error(`vite dev exited: ${code}`)));
	});
}

// Registered before the page's own modules, it keeps grai/sveltekit/client from cancelling the
// edit's event, so the dev module reloads the page.
const reloadOnly = () =>
	addEventListener("grai:change", (event) => event.stopImmediatePropagation());

const median = (values) =>
	[...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

async function editTimes(browser, design, original) {
	const page = await (await browser.newContext()).newPage();
	if (design === "reload") await page.addInitScript(reloadOnly);
	await page.goto(`http://localhost:${PORT}/ro/`);
	await page.getByText("Desenat în browser").waitFor();
	const times = [];
	for (let edit = 0; edit < EDITS; edit++) {
		const text = `Salut ${design} ${edit}`;
		const catalog = { ...JSON.parse(original), greeting: text };
		const saved = performance.now();
		writeFileSync(catalogFile, `${JSON.stringify(catalog, null, "\t")}\n`);
		await page.getByRole("heading", { name: text }).waitFor();
		times.push(performance.now() - saved);
		// The page settles before the next edit: a reload's hydration, the in-place loads' refresh.
		await page.getByText("Desenat în browser").waitFor();
		await page.waitForLoadState("networkidle");
	}
	await page.context().close();
	return times;
}

const original = readFileSync(catalogFile, "utf8");
const server = await devServer();
const browser = await chromium.launch();
try {
	for (const design of ["in place", "reload"]) {
		const times = await editTimes(browser, design, original);
		console.log(
			`${design.padEnd(8)}  median ${median(times).toFixed(0)} ms, min ${Math.min(...times).toFixed(0)}, max ${Math.max(...times).toFixed(0)} (${EDITS} edits)`,
		);
	}
} finally {
	writeFileSync(catalogFile, original);
	await browser.close();
	server.kill();
}
