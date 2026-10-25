// Serves a Worker's module under Bun on 127.0.0.1 alone, at the port its second argument names, and
// prints the URL Bun gives the server. `bun <module>` serves the same handler on every address, as
// Bun takes no hostname for it, and macOS lets another process listen on 127.0.0.1 at that port
// beside it: a request to 127.0.0.1 then reaches that one.
//   bun test/bun-serve.js <module> <port>
const [module, port] = process.argv.slice(2);
const { default: worker } = await import(module);
const server = Bun.serve({
	fetch: (request, bun) => worker.fetch(request, bun),
	hostname: "127.0.0.1",
	port: Number(port),
});
console.log(server.url.href);
