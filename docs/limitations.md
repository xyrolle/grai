# Limitations

- **A Next app started on a loopback address, `127.0.0.1` or `[::1]`, never answers a page:** there Next 16.4 sends each of the proxy's rewrites back to itself, and @xyrolle/grai/next's proxy rewrites each one again. Start Next on its default host, `0.0.0.0` or the machine's address, as behind a reverse proxy, until Next ships the fix to [vercel/next.js#94745](https://github.com/vercel/next.js/issues/94745) (`docs/followups.md`).
- **Under a CSP of hashes, a built SvelteKit page downloads its locale's message chunks and the shared ones.** The browser refuses the import map, which carries Kit's nonce but no hash yet. A CSP of nonces works, as Kit's `auto` mode gives a page it renders on request.
- **A Vite build refuses a text that holds `!~{…}~`, such as `!~{000}~`:** that is Rolldown's placeholder for a chunk's hash, which it replaces with the hash wherever it is in a chunk's code. No way of writing it survives: Rolldown prints a string by its value, and folds an escaped template, a concatenation or a join back into one string, before the hashes go in (`docs/followups.md`).
- **A check with no facts kept takes seconds on a large project,** where matching text would not ([the commands' chart](benchmarks.md#the-refactoring-commands)); with its facts kept in CI ([the guide's CI section](guide.md#ci)) it reads only the files that changed. It parses each file that may read messages and resolves its imports, which is what makes its reads exact. Matching text cannot tell a read from a mention, and follows no import.
- **Not supported yet:**
  - `:unit`'s `usage`, which converts to the locale's units;
  - an option's value taken from an input, other than a currency, a unit and a time zone (`currency=$code` and `:relativetime`'s `unit=$unit` work), such as `style=$style`.

  Each is a compile error that names the construct, never an approximation. `docs/followups.md` tracks them.
