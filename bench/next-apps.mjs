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
import { compile } from "grai";
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

/** A client component that records when a target's text changes, for the edit bench. */
const observer = `"use client";
import { useEffect } from "react";

export function Observer() {
	useEffect(() => {
		const changes = {};
		Object.assign(window, { changes });
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
			imports: 'import { withGrai } from "grai/next/config";',
			call: "withGrai",
		}),
		"src/proxy.js": `export { proxy } from "grai/next/proxy";\n${proxyConfig}`,
		"src/app/[locale]/layout.jsx": `import { bindLocale, LocaleProvider } from "grai/next";

export default async function Layout({ children, params }) {
	const { locale } = await params;
	bindLocale(locale);
	return <html lang={locale}><body><LocaleProvider locale={locale}>{children}</LocaleProvider></body></html>;
}
`,
		"src/app/[locale]/page.jsx": `import { bindLocale } from "grai/next";
import { m } from "../../i18n/messages.js";
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
import { m } from "../../i18n/messages.js";

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

/** The page with one locale's words written in, from grai's output for that locale. */
async function writePlain(app, keys, locale, graiRoot) {
	const root = join(nextDir, "plain");
	const { m } = await import(
		pathToFileURL(join(graiRoot, "src/i18n/messages.js")).href
	);
	const words = (list) =>
		list
			.map((key) => {
				const inputs = inputsOf(app.messages[app.baseLocale][key]);
				return `\t\t\t<li>{${JSON.stringify(m[key](inputs, { locale }))}}</li>`;
			})
			.join("\n");
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
${words(keys.server)}
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
${words(keys.client)}
		</ul>
	);
}
`,
	});
	return root;
}

/** Writes the four apps for one catalog, and compiles grai's catalogs for the plain page's words. */
export async function writeNextApps(app, locale) {
	const keys = pageKeys(app);
	const grai = writeGrai(app, keys);
	const result = await compile(join(grai, "grai.config.json"));
	if (result.errors.length > 0) throw result.errors[0];
	return {
		keys,
		apps: {
			grai,
			"next-intl": writeNextIntl(app, keys, { picked: false }),
			"next-intl, client keys picked": writeNextIntl(app, keys, {
				picked: true,
			}),
			plain: await writePlain(app, keys, locale, grai),
		},
	};
}
