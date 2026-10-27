// The same Next.js App Router page three times, written from a catalog: on grai, on next-intl and
// with its words written in (no library), the floor for bytes. The page is a server component
// rendering SERVER_KEYS messages and a client component rendering CLIENT_KEYS, chosen evenly
// across the keys both libraries can hold, so it has the catalog's share of plurals, inputs and
// markup. next-intl reads the ICU catalog libraries.mjs writes, its markup dropped as grai's string
// call drops it. Each app sits under bench/.cache/next/, inside bench's own install of next, react,
// next-intl and grai.
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compile } from "@xyrolle/grai";
import { cacheDir } from "./apps.mjs";
import { libraryCatalogs, portable } from "./libraries.mjs";

export const SERVER_KEYS = 400;
export const CLIENT_KEYS = 100;
const benchDir = new URL(".", import.meta.url).pathname;
export const nextDir = join(cacheDir, "next");

/**
 * The keys the page renders, evenly spaced, which of them the client component renders, and in
 * each component the first message of plain words, which the edit bench edits.
 */
export function pageKeys(app) {
	const base = app.messages[app.baseLocale];
	const keys = Object.keys(base).filter((key) => portable(app, key));
	const total = SERVER_KEYS + CLIENT_KEYS;
	const chosen = Array.from(
		{ length: total },
		(_, index) => keys[Math.floor((index * keys.length) / total)],
	);
	const server = chosen.filter((_, index) => index % 5 !== 0);
	const client = chosen.filter((_, index) => index % 5 === 0);
	const plain = (key) =>
		typeof base[key] === "string" && !base[key].includes("{");
	return {
		server,
		client,
		targets: { server: server.find(plain), client: client.find(plain) },
	};
}

/** The inputs a message reads, each with a value: a count of 3, and a name. */
function inputsOf(message) {
	const source = JSON.stringify(message);
	const inputs = {};
	for (const [, name] of source.matchAll(/\{(\w+)\}/g)) inputs[name] = "Ana";
	for (const [, name] of source.matchAll(/input (\w+)/g)) inputs[name] = 3;
	return inputs;
}

const call = (target, key, inputs) =>
	Object.keys(inputs).length === 0
		? `${target}(${JSON.stringify(key)})`
		: `${target}(${JSON.stringify(key)}, ${JSON.stringify(inputs)})`;

/**
 * The list items of a component: `render(key, inputs)` gives each one's expression, and the
 * edited message's item has the id `<component>-target`.
 */
function items(keys, app, render, component) {
	const target = pageKeys(app).targets[component];
	return keys
		.map((key) => {
			const inputs = inputsOf(app.messages[app.baseLocale][key]);
			const id = key === target ? ` id="${component}-target"` : "";
			return `\t\t\t<li${id}>{${render(key, inputs)}}</li>`;
		})
		.join("\n");
}

/**
 * A client component that stamps when React has hydrated the page, for the cold start bench, and
 * records when a target's text changes, for the edit bench.
 */
const observer = `"use client";
import { useEffect } from "react";

export function Observer() {
	useEffect(() => {
		const changes = {};
		Object.assign(window, { changes, hydratedAt: performance.timeOrigin + performance.now() });
		new MutationObserver(() => {
			for (const id of ["server-target", "client-target"]) {
				const text = document.getElementById(id)?.textContent;
				if (changes[id]?.text !== text) {
					changes[id] = { text, at: performance.timeOrigin + performance.now() };
				}
			}
		}).observe(document.body, { childList: true, characterData: true, subtree: true });
	}, []);
	return null;
}
`;

const proxyConfig = `export const config = { matcher: ["/((?!api|_next|.*\\\\..*).*)"] };\n`;

function nextConfig(wrap) {
	return `${wrap.imports}
export default ${wrap.call}({
	turbopack: { root: ${JSON.stringify(benchDir)} },
	outputFileTracingRoot: ${JSON.stringify(benchDir)},
});
`;
}

function writeFiles(root, files) {
	rmSync(root, { recursive: true, force: true });
	for (const [path, content] of Object.entries(files)) {
		mkdirSync(join(root, path, ".."), { recursive: true });
		writeFileSync(join(root, path), content);
	}
}

function writeGrai(app, keys) {
	const root = join(nextDir, "grai");
	writeFiles(root, {
		"grai.config.json": JSON.stringify({
			locales: app.locales,
			baseLocale: app.baseLocale,
			catalogs: "messages/{locale}.json",
			outdir: "src/i18n",
			strategy: ["url"],
		}),
		"next.config.mjs": nextConfig({
			imports: 'import { withGrai } from "@xyrolle/grai/next/config";',
			call: "withGrai",
		}),
		"src/proxy.js": `export { proxy } from "@xyrolle/grai/next/proxy";\n${proxyConfig}`,
		"src/app/[locale]/layout.jsx": `import { bindLocale, LocaleProvider } from "@xyrolle/grai/next";

export default async function Layout({ children, params }) {
	const { locale } = await params;
	bindLocale(locale);
	return <html lang={locale}><body><LocaleProvider locale={locale}>{children}</LocaleProvider></body></html>;
}
`,
		"src/app/[locale]/page.jsx": `import { bindLocale } from "@xyrolle/grai/next";
import * as m from "../../i18n/keys.js";
import { Client } from "./client.jsx";
import { Observer } from "../observer.jsx";

export default async function Page({ params }) {
	bindLocale((await params).locale);
	return (
		<main>
			<ul>
${items(keys.server, app, (key, inputs) => `m.${key}(${Object.keys(inputs).length === 0 ? "" : JSON.stringify(inputs)})`, "server")}
			</ul>
			<Client />
			<Observer />
		</main>
	);
}
`,
		"src/app/[locale]/client.jsx": `"use client";
import * as m from "../../i18n/keys.js";

export function Client() {
	return (
		<ul>
${items(keys.client, app, (key, inputs) => `m.${key}(${Object.keys(inputs).length === 0 ? "" : JSON.stringify(inputs)})`, "client")}
		</ul>
	);
}
`,
		"src/app/observer.jsx": observer,
	});
	cpSync(join(app.root, "messages"), join(root, "messages"), {
		recursive: true,
	});
	return root;
}

function writeNextIntl(app, keys, { picked }) {
	const root = join(nextDir, picked ? "next-intl-picked" : "next-intl");
	const messages = {};
	for (const locale of app.locales) {
		messages[`messages/${locale}.json`] = JSON.stringify(
			libraryCatalogs(app, locale).icu,
			null,
			"\t",
		);
	}
	const provider = picked
		? `<NextIntlClientProvider messages={pick(await getMessages(), ${JSON.stringify(keys.client)})}>`
		: "<NextIntlClientProvider>";
	writeFiles(root, {
		...messages,
		"next.config.mjs": nextConfig({
			imports: 'import createNextIntlPlugin from "next-intl/plugin";',
			call: "createNextIntlPlugin()",
		}),
		"src/i18n/routing.js": `import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
	locales: ${JSON.stringify(app.locales)},
	defaultLocale: ${JSON.stringify(app.baseLocale)},
	localePrefix: "as-needed",
	localeDetection: false,
});
`,
		"src/i18n/request.js": `import { hasLocale } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing.js";

export default getRequestConfig(async ({ requestLocale }) => {
	const requested = await requestLocale;
	const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
	return { locale, messages: (await import(\`../../messages/\${locale}.json\`)).default };
});
`,
		"src/proxy.js": `import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing.js";

export default createMiddleware(routing);
${proxyConfig}`,
		"src/app/[locale]/layout.jsx": `import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";

const pick = (messages, keys) => Object.fromEntries(keys.map((key) => [key, messages[key]]));

export default async function Layout({ children, params }) {
	const { locale } = await params;
	setRequestLocale(locale);
	return <html lang={locale}><body>${provider}{children}</NextIntlClientProvider></body></html>;
}
`,
		"src/app/[locale]/page.jsx": `import { getTranslations, setRequestLocale } from "next-intl/server";
import { Client } from "./client.jsx";
import { Observer } from "../observer.jsx";

export default async function Page({ params }) {
	setRequestLocale((await params).locale);
	const t = await getTranslations();
	return (
		<main>
			<ul>
${items(keys.server, app, (key, inputs) => call("t", key, inputs), "server")}
			</ul>
			<Client />
			<Observer />
		</main>
	);
}
`,
		"src/app/[locale]/client.jsx": `"use client";
import { useTranslations } from "next-intl";

export function Client() {
	const t = useTranslations();
	return (
		<ul>
${items(keys.client, app, (key, inputs) => call("t", key, inputs), "client")}
		</ul>
	);
}
`,
		"src/app/observer.jsx": observer,
	});
	return root;
}

/**
 * The words of the page's messages in one locale, in the order it lists them, from grai's output:
 * the server component's, then the client component's.
 */
async function pageWords(app, keys, locale, graiRoot) {
	const { m } = await import(
		pathToFileURL(join(graiRoot, "src/i18n/messages.js")).href
	);
	const words = (list) =>
		list.map((key) =>
			m[key](inputsOf(app.messages[app.baseLocale][key]), { locale }),
		);
	return { server: words(keys.server), client: words(keys.client) };
}

/** The page with one locale's words written in. */
function writePlain(words, locale) {
	const root = join(nextDir, "plain");
	const items = (list) =>
		list.map((word) => `\t\t\t<li>{${JSON.stringify(word)}}</li>`).join("\n");
	writeFiles(root, {
		"next.config.mjs": nextConfig({ imports: "", call: "" }),
		[`src/app/${locale}/layout.jsx`]: `export default function Layout({ children }) {
	return <html lang=${JSON.stringify(locale)}><body>{children}</body></html>;
}
`,
		[`src/app/${locale}/page.jsx`]: `import { Client } from "./client.jsx";

export default function Page() {
	return (
		<main>
			<ul>
${items(words.server)}
			</ul>
			<Client />
		</main>
	);
}
`,
		[`src/app/${locale}/client.jsx`]: `"use client";

export function Client() {
	return (
		<ul>
${items(words.client)}
		</ul>
	);
}
`,
	});
	return root;
}

/**
 * Writes the four apps for one catalog, after compiling grai's catalogs for the page's words: the
 * words of the page's messages, in its order, which every app's page lists.
 */
export async function writeNextApps(app, locale) {
	const keys = pageKeys(app);
	const grai = writeGrai(app, keys);
	const result = await compile(join(grai, "grai.config.json"));
	if (result.errors.length > 0) throw result.errors[0];
	const words = await pageWords(app, keys, locale, grai);
	return {
		keys,
		words: [...words.server, ...words.client],
		apps: {
			grai,
			"next-intl": writeNextIntl(app, keys, { picked: false }),
			"next-intl, client keys picked": writeNextIntl(app, keys, {
				picked: true,
			}),
			plain: writePlain(words, locale),
		},
	};
}
