// Starting `next` in one of the bench's apps (next-apps.mjs), each clock from the process's launch:
// until Next says it is ready, until the page's first response is complete, and until Chromium has
// hydrated the page. Each checks that the page lists every message it renders, in order, so that a
// page answering sooner with an error or with fewer words never counts as faster.
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { startServer } from "./servers.mjs";

export const next = new URL("node_modules/.bin/next", import.meta.url).pathname;
export const nextVersion = JSON.parse(
	readFileSync(new URL("node_modules/next/package.json", import.meta.url)),
).version;
/** Next's environment: no telemetry, which would phone home and outlive the run in a process of its own. */
export const nextEnv = { ...process.env, NEXT_TELEMETRY_DISABLED: "1" };
const now = () => performance.timeOrigin + performance.now();

/**
 * Starts `next <command>` in an app on a port the system picks, so that runs side by side never
 * meet. `listening` resolves once Next prints a line matching `ready`, with the URL it serves and
 * the ms since `launched`, the moment before the process was spawned.
 */
export function started(root, command, ready) {
	const launched = now();
	const child = startServer(next, [command, "--port", "0"], {
		cwd: root,
		env: nextEnv,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	const listening = new Promise((resolve, reject) => {
		const deadline = setTimeout(
			() =>
				reject(new Error(`next ${command} was not ready in 120 s:\n${output}`)),
			120_000,
		);
		const read = (chunk) => {
			output += chunk;
			const origin = /- Local:\s+(http:\/\/\S+)/.exec(output)?.[1];
			if (origin !== undefined && ready.test(output)) {
				clearTimeout(deadline);
				resolve({ origin, ready: now() - launched });
			}
		};
		child.stdout.on("data", read);
		child.stderr.on("data", read);
	});
	return { child, launched, listening };
}

/** Requests a URL until it answers 200, for at most two minutes; resolves with its whole body. */
async function firstResponse(url) {
	const start = performance.now();
	while (performance.now() - start < 120_000) {
		const response = await fetch(url).catch(() => undefined);
		if (response?.ok) return response.text();
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`${url} did not answer in 120 s`);
}

/** The few entities React writes in a text, and any numeric one. */
const entities = { amp: "&", lt: "<", gt: ">", quot: '"' };
const decoded = (html) =>
	html.replace(/&(?:(\w+)|#(\d+)|#x([\da-f]+));/gi, (entity, name, dec, hex) =>
		name !== undefined
			? (entities[name] ?? entity)
			: String.fromCodePoint(
					dec !== undefined ? Number(dec) : Number.parseInt(hex, 16),
				),
	);

/** The texts of a document's list items, in order: each item of the bench's page holds one message. */
const listed = (html) =>
	[...html.matchAll(/<li(?: id="[^"]*")?>([^<]*)<\/li>/g)].map(([, text]) =>
		decoded(text),
	);

/** Throws unless `texts` are the page's `words`, in order, naming the first that differs. */
export function assertListed(texts, words, where) {
	const index = words.findIndex((word, at) => texts[at] !== word);
	if (index === -1 && texts.length === words.length) return;
	const at = index === -1 ? words.length : index;
	throw new Error(
		`${where} lists ${texts.length} messages for ${words.length}; item ${at} is ${JSON.stringify(texts[at])}, not ${JSON.stringify(words[at])}.`,
	);
}

/** The CPU every process of a server's group has used, user and system, ms. */
function groupCpu(pid) {
	const run = (command, args) =>
		spawnSync(command, args, { encoding: "utf8" }).stdout.trim();
	const pids = run("pgrep", ["-g", String(pid)])
		.split("\n")
		.join(",");
	return run("ps", ["-o", "time=", "-p", pids])
		.split("\n")
		.reduce((sum, time) => {
			const [minutes, seconds] = time.trim().split(":").map(Number);
			return sum + (minutes * 60 + seconds) * 1000;
		}, 0);
}

/** Removes the app's directories a start should begin without, such as `.next`. */
function clear(root, directories) {
	for (const directory of directories)
		rmSync(join(root, directory), { recursive: true, force: true });
}

/**
 * `next dev` from its launch until it is ready, and until the page's first response is complete and
 * lists `words`, with the CPU Next's processes used until then, after removing the app's
 * directories `cleared` names. The server is left running.
 */
export async function devStart(root, path, words, cleared = []) {
	clear(root, cleared);
	const server = started(root, "dev", /Ready in/);
	const { origin, ready } = await server.listening;
	const url = `${origin}${path}`;
	const html = await firstResponse(url);
	const page = now() - server.launched;
	assertListed(listed(html), words, `${url}'s first response`);
	return { server, url, ready, page, cpu: groupCpu(server.child.pid) };
}

/**
 * `next dev` from its launch until Chromium, in a context of its own, has hydrated the page and it
 * lists `words`, after removing the app's directories `cleared` names: the page's Observer stamps
 * `hydratedAt` in its effect, which runs once React has hydrated the page. Also from its launch, when
 * the document's first byte came: what came after it is the page's time in Chromium, its scripts'
 * loading and hydration, apart from Next's compile and render before it. A hydration error fails
 * the run. The server is left running.
 */
export async function hydratedStart(browser, root, path, words, cleared = []) {
	clear(root, cleared);
	const server = started(root, "dev", /Ready in/);
	const { origin } = await server.listening;
	const url = `${origin}${path}`;
	const context = await browser.newContext();
	const page = await context.newPage();
	const errors = [];
	page.on("pageerror", (error) => errors.push(error.message));
	page.on("console", (message) => {
		if (message.type() === "error" && /hydrat/i.test(message.text()))
			errors.push(message.text());
	});
	await page.goto(url, { waitUntil: "commit", timeout: 120_000 });
	const hydratedAt = await page
		.waitForFunction(() => window.hydratedAt, null, { timeout: 120_000 })
		.then((handle) => handle.jsonValue());
	const documentAt = await page.evaluate(
		() =>
			performance.timeOrigin +
			performance.getEntriesByType("navigation")[0].responseStart,
	);
	const texts = await page.$$eval("li", (items) =>
		items.map((item) => item.textContent),
	);
	await context.close();
	if (errors.length > 0)
		throw new Error(`${url} failed to hydrate:\n${errors.join("\n")}`);
	assertListed(texts, words, `${url} once hydrated`);
	return {
		server,
		hydrated: hydratedAt - server.launched,
		document: documentAt - server.launched,
	};
}
