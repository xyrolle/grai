// The example's server. `node server.ts --dev` renders through Vite's dev server, which takes
// each edit; `node server.ts` serves the build of `pnpm build`. src/entry-server.ts renders each
// page in its request's locale, its <html> in that locale and its direction.
import { readFile, stat } from "node:fs/promises";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { extname, join } from "node:path";

type Render = (request: Request, template: string) => Promise<Response>;
type Next = () => void;

/** What the server needs of the app: its files and modules, and a page's template and render. */
type App = {
	files(incoming: IncomingMessage, outgoing: ServerResponse, next: Next): void;
	page(url: string): Promise<{ template: string; render: Render }>;
};

const dev = process.argv.includes("--dev");
const port = Number(process.env.PORT ?? (dev ? 4821 : 4820));
const root = import.meta.dirname;
const server = createServer();
const app = dev ? await viteApp() : await builtApp();

server.on("request", (incoming, outgoing) =>
	app.files(incoming, outgoing, () => {
		renderPage(incoming, outgoing).catch((error: unknown) => {
			console.error(error);
			outgoing.statusCode = 500;
			outgoing.end();
		});
	}),
);
server.listen(port, () => console.log(`Listening on http://localhost:${port}`));

async function renderPage(
	incoming: IncomingMessage,
	outgoing: ServerResponse,
): Promise<void> {
	const { template, render } = await app.page(incoming.url ?? "/");
	const response = await render(requestOf(incoming), template);
	outgoing.statusCode = response.status;
	for (const [name, value] of response.headers) outgoing.setHeader(name, value);
	outgoing.end(await response.text());
}

/** The request as the output's middleware reads it. */
function requestOf(incoming: IncomingMessage): Request {
	const headers = new Headers();
	for (const [name, values] of Object.entries(incoming.headersDistinct)) {
		for (const value of values ?? []) headers.append(name, value);
	}
	const origin = `http://${incoming.headers.host ?? "localhost"}`;
	return new Request(new URL(incoming.url ?? "/", origin), { headers });
}

/** The app through Vite's dev server, its HMR on this server's port. */
async function viteApp(): Promise<App> {
	const { createServer: createViteServer, isRunnableDevEnvironment } =
		await import("vite");
	const vite = await createViteServer({
		root,
		appType: "custom",
		server: { middlewareMode: true, hmr: { server } },
	});
	const ssr = vite.environments.ssr;
	if (!isRunnableDevEnvironment(ssr)) {
		throw new Error("Vite's ssr environment does not run its modules.");
	}
	return {
		files: (incoming, outgoing, next) =>
			vite.middlewares(incoming, outgoing, next),
		async page(url) {
			const html = await readFile(join(root, "index.html"), "utf8");
			const { render } = await ssr.runner.import<{ render: Render }>(
				"/src/entry-server.ts",
			);
			return { template: await vite.transformIndexHtml(url, html), render };
		},
	};
}

const contentTypes: Record<string, string> = {
	".js": "text/javascript",
	".css": "text/css",
};

/** The build: the client's files as they are, and the server's render. */
async function builtApp(): Promise<App> {
	const client = join(root, "dist/client");
	const template = await readFile(join(client, "index.html"), "utf8");
	const { render }: { render: Render } = await import(
		join(root, "dist/server/entry-server.js")
	);
	/** The client file a URL names, if there is one; its page is rendered instead. */
	const fileOf = async (url: string) => {
		const { pathname } = new URL(url, "http://localhost");
		const file = join(client, pathname);
		const found = await stat(file).catch(() => undefined);
		return pathname !== "/" && found?.isFile() ? file : undefined;
	};
	const send = async (file: string, outgoing: ServerResponse) => {
		const type = contentTypes[extname(file)] ?? "application/octet-stream";
		outgoing.setHeader("content-type", type);
		outgoing.end(await readFile(file));
	};
	return {
		files(incoming, outgoing, next) {
			fileOf(incoming.url ?? "/")
				.then((file) => (file === undefined ? next() : send(file, outgoing)))
				.catch((error: unknown) => {
					console.error(error);
					outgoing.statusCode = 500;
					outgoing.end();
				});
		},
		page: async () => ({ template, render }),
	};
}
