import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { createServer } from "vite";
import { expect, it, onTestFinished } from "vitest";
import { grai } from "../src/vite.ts";
import { project } from "./project.ts";

const repository = fileURLToPath(new URL("..", import.meta.url));

/**
 * Two Vue components, with grai/vue/client imported: one shows the title and counts its clicks,
 * the other shows a note; each counts its renders.
 */
const main = `import "grai/vue/client";
import { createApp, h, ref } from "vue";
import { m } from "./out/messages.js";

const clicks = ref(0);
const renders = { title: 0, note: 0 };
const Title = {
	render: () => {
		renders.title += 1;
		return h("button", { onClick: () => (clicks.value += 1) }, \`\${m.title()} \${clicks.value}\`);
	},
};
const Note = {
	render: () => {
		renders.note += 1;
		return h("p", m.note());
	},
};
createApp({ render: () => [h(Title), h(Note)] }).mount("#app");
window.renders = renders;
window.loaded = performance.timeOrigin;
`;

it("renders again in place, after an edit, the Vue components that called an edited message, which keep their state", async () => {
	const { dir } = project({
		en: { title: "Title", note: "Note" },
		de: { title: "Titel", note: "Hinweis" },
	});
	writeFileSync(
		join(dir, "index.html"),
		`<!doctype html><html lang="de"><div id="app"></div><script type="module" src="/main.js"></script>`,
	);
	writeFileSync(join(dir, "main.js"), main);
	const server = await createServer({
		root: dir,
		configFile: false,
		logLevel: "silent",
		// Vue's own build flags, which @vitejs/plugin-vue would define.
		define: {
			__VUE_OPTIONS_API__: "true",
			__VUE_PROD_DEVTOOLS__: "false",
			__VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
		},
		// Vue's modules served as they are, so that no pre-bundling reloads the page.
		optimizeDeps: { noDiscovery: true },
		resolve: {
			alias: {
				"grai/vue/client": join(repository, "src/vue/client.ts"),
				vue: join(repository, "node_modules/vue"),
			},
		},
		server: {
			port: 0,
			fs: { allow: [dir, repository] },
			// macOS reports files written just before the watcher starts as changed (vite.test.ts).
			watch: { ignored: ["**/index.html", "**/main.js"] },
		},
		plugins: [grai()],
	});
	await server.listen();
	onTestFinished(() => server.close());
	const browser = await chromium.launch();
	onTestFinished(() => browser.close());
	const page = await browser.newPage();
	await page.goto(server.resolvedUrls?.local[0] ?? "");
	await page.getByRole("button", { name: "Titel 0" }).click();
	await page.getByRole("button", { name: "Titel 1" }).waitFor();
	const loaded = await page.evaluate("window.loaded");

	const catalog = join(dir, "messages", "de.json");
	writeFileSync(
		catalog,
		readFileSync(catalog, "utf8").replace('"Titel"', '"Überschrift"'),
	);
	await page.getByRole("button", { name: "Überschrift 1" }).waitFor();

	expect(await page.evaluate("window.loaded")).toBe(loaded);
	expect(await page.evaluate("window.renders")).toEqual({ title: 3, note: 1 });
});
