// A language server over stdio, as an editor drives one: JSON-RPC messages framed by their
// Content-Length, requests answered in order, and the server's own requests (configuration,
// capability registration, progress) answered as an editor that has nothing to add would. The
// server runs in its own process group, which `stop` ends, and so does this process's exit.
import { spawn } from "node:child_process";

/** Starts the server's command and returns its client. */
export function startServer(command, args, options) {
	const server = spawn(command, args, {
		...options,
		stdio: ["pipe", "pipe", "inherit"],
		detached: true,
	});
	const stop = () => {
		try {
			process.kill(-server.pid, "SIGKILL");
		} catch {}
	};
	process.on("exit", stop);
	const pending = new Map();
	let nextId = 1;
	let buffer = Buffer.alloc(0);
	const send = (message) => {
		const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }));
		server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
		server.stdin.write(body);
	};
	const answer = (message) => {
		const result =
			message.method === "workspace/configuration"
				? message.params.items.map(() => null)
				: null;
		send({ id: message.id, result });
	};
	server.stdout.on("data", (chunk) => {
		buffer = Buffer.concat([buffer, chunk]);
		for (;;) {
			const end = buffer.indexOf("\r\n\r\n");
			if (end < 0) return;
			const length = Number(
				/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())?.[1],
			);
			if (buffer.length < end + 4 + length) return;
			const message = JSON.parse(
				buffer.subarray(end + 4, end + 4 + length).toString(),
			);
			buffer = buffer.subarray(end + 4 + length);
			if (message.method === undefined) {
				pending.get(message.id)?.(message);
				pending.delete(message.id);
			} else if (message.id !== undefined) answer(message);
		}
	});
	const exited = new Promise((resolve) => server.on("exit", resolve));
	return {
		request(method, params) {
			const id = nextId++;
			send({ id, method, ...(params && { params }) });
			return new Promise((resolve, reject) => {
				pending.set(id, (message) =>
					message.error
						? reject(new Error(`${method}: ${message.error.message}`))
						: resolve(message.result),
				);
				exited.then(() =>
					reject(new Error(`${method}: the server exited first`)),
				);
			});
		},
		notify(method, params) {
			send({ method, ...(params && { params }) });
		},
		stop,
	};
}
