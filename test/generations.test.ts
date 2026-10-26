import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it, onTestFinished, vi } from "vitest";
import { type Messages, project } from "./project.ts";
import { loadedCopy, outputReader } from "./reader.ts";

/** What a copy's `price` says, or the error its import or call threw. */
async function priceIn(copy: string): Promise<string> {
	try {
		const { m }: { m: Messages } = await import(pathToFileURL(copy).href);
		return m.price?.({ n: 1.234 }) ?? "no price";
	} catch (error) {
		return String(error);
	}
}

it("lets a reader load the output while compiles change its formatters, and it loads one output whole", async () => {
	const price = (digits: number) => ({
		en: { price: `Price {n :number maximumFractionDigits=${digits}}` },
		de: { price: `Preis {n :number maximumFractionDigits=${digits}}` },
	});
	const { dir, compile } = project(price(1));
	await compile();
	const out = join(dir, "out");
	let compiling = true;
	const writer = (async () => {
		for (let edit = 0; edit < 40; edit++) {
			const catalogs = price(edit % 2 === 0 ? 2 : 1);
			for (const [locale, catalog] of Object.entries(catalogs))
				writeFileSync(
					join(dir, "messages", `${locale}.json`),
					JSON.stringify(catalog),
				);
			expect((await compile()).errors).toEqual([]);
		}
		compiling = false;
	})();
	const copies: (string | Error)[] = [];
	while (compiling) copies.push(await loadedCopy(out));
	await writer;
	const prices = await Promise.all(
		copies.map((copy) =>
			typeof copy === "string" ? priceIn(copy) : String(copy),
		),
	);

	expect(prices.length).toBeGreaterThan(40);
	expect(
		prices.filter((said) => said !== "Price 1.2" && said !== "Price 1.23"),
	).toEqual([]);
});

const catalogs = {
	en: { title: "Title", greeting: "Hello {name}" },
	de: { title: "Titel", greeting: "Hallo {name}" },
};

it("keeps the files the output stops naming while a reader may still load them, then removes them", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	onTestFinished(() => {
		vi.useRealTimers();
	});
	const { dir, compile } = project(catalogs);
	const out = join(dir, "out");
	const shards = () =>
		readdirSync(join(out, "keys")).filter((file) => file.endsWith(".js"));
	const edit = (title: string) =>
		writeFileSync(
			join(dir, "messages", "de.json"),
			JSON.stringify({ ...catalogs.de, title }),
		);
	await compile();
	const [first] = shards();
	edit("Kopf");
	await compile();
	const [second] = shards().filter((file) => file !== first);
	vi.setSystemTime(Date.now() + 10_000);
	edit("Titelzeile");
	await compile();

	expect(shards()).not.toContain(first);
	expect(shards()).toContain(second);
	expect(shards()).toHaveLength(2);
	expect(readFileSync(join(out, "keys.js"), "utf8")).not.toContain(
		second?.replace(".js", ""),
	);
});

/** A server that renders `m.title()` in each request's locale, as the cookie names it. */
const cookieServer = { strategy: ["cookie"], cookieName: "locale" };

/**
 * Reads an application that imports the middleware and the messages, as Node does: server.js and
 * all it imports, then `between`, then messages.js and all it imports. Gives what a request whose
 * cookie names German renders.
 */
async function renderedAcross(dir: string, between: () => Promise<unknown>) {
	const reader = outputReader(join(dir, "out"));
	await reader.read("server.js");
	await between();
	await reader.read("messages.js");
	writeFileSync(
		join(reader.copy, "app.js"),
		`import { middleware } from "./server.js";
import { m } from "./messages.js";
export const render = (request) => middleware(request, () => new Response(m.title()));
`,
	);
	const app = await import(pathToFileURL(join(reader.copy, "app.js")).href);
	const response = await app.render(
		new Request("https://example.com/", { headers: { cookie: "locale=de" } }),
	);
	return response.text();
}

it("loads one runtime for the middleware and the messages, though the config changed between them", async () => {
	const { dir, config, compile } = project(catalogs, cookieServer);
	await compile();

	const rendered = await renderedAcross(dir, async () => {
		writeFileSync(
			config,
			JSON.stringify({
				...JSON.parse(readFileSync(config, "utf8")),
				cookieMaxAge: 3600,
			}),
		);
		expect((await compile()).errors).toEqual([]);
	});

	expect(rendered).toBe("Titel");
});

it("refuses keys compiled for other locales than the runtime it loaded, as when the locales changed while it loaded", async () => {
	const { dir, config, compile } = project(catalogs, cookieServer);
	await compile();

	const rendered = renderedAcross(dir, async () => {
		writeFileSync(
			join(dir, "messages", "fr.json"),
			JSON.stringify({ title: "Titre", greeting: "Salut {name}" }),
		);
		writeFileSync(
			config,
			JSON.stringify({
				...JSON.parse(readFileSync(config, "utf8")),
				locales: ["en", "de", "fr"],
			}),
		);
		expect((await compile()).errors).toEqual([]);
	});

	await expect(rendered).rejects.toMatchObject({ code: "output-changed" });
});
