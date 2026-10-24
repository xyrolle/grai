// Does an import map apply to <link rel="modulepreload">? A document maps /shared/ to /ro/, preloads
// /shared/m.js and imports it; the requests it makes say which files the browser fetched.
//   node preload.mjs
import { chromium, webkit } from "playwright-core";

const document = `<!doctype html>
<script type="importmap">{"imports":{"/shared/":"/ro/"}}</script>
<link rel="modulepreload" href="/shared/m.js">
<script type="module">import { url } from "/shared/m.js"; window.imported = url;</script>`;

for (const [name, engine] of [
	["Chromium", chromium],
	["WebKit", webkit],
]) {
	const browser = await engine.launch();
	const page = await browser.newPage();
	const requested = [];
	await page.route("https://bench.test/**", (route) => {
		const path = new URL(route.request().url()).pathname;
		requested.push(path);
		if (path === "/")
			return route.fulfill({ contentType: "text/html", body: document });
		return route.fulfill({
			contentType: "text/javascript",
			body: `export const url = ${JSON.stringify(path)};`,
		});
	});
	await page.goto("https://bench.test/");
	const imported = await page
		.waitForFunction(() => window.imported)
		.then((handle) => handle.jsonValue());
	await page.waitForLoadState("networkidle");
	console.log(
		`${name} ${browser.version()}: imported ${imported}; fetched ${requested.filter((path) => path !== "/").join(" and ")}`,
	);
	await browser.close();
}
