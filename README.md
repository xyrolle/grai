# grai

Translations compiled ahead of time into plain, typed functions, for any JavaScript framework. A page loads only the keys it uses, and an edited message shows in under a second.

*Grai* (Romanian) is a people's way of speaking.

## Install

grai is not on npm yet. Once it is:

```sh
pnpm add -D grai
```

## Usage

Catalogs are the inlang message format, one JSON file per locale, as Paraglide reads them. `grai.config.json` names them:

```json
{
	"locales": ["en", "de"],
	"baseLocale": "en",
	"catalogs": "messages/{locale}.json",
	"outdir": "src/lib/i18n"
}
```

```json
{
	"cart_title": "Your cart",
	"cart_total": "Total {amount :number style=currency currency=EUR}"
}
```

`grai compile` writes the output; `grai watch` writes it again on each edit. Each message becomes a typed function:

```ts
import { m } from "./src/lib/i18n/messages.js";

m.cart_title(); // "Your cart"
m.cart_title({}, { locale: "de" }); // the German text
m.cart_total({ amount: 12.5 }); // "Total €12.50"
```

`runtime.js` beside it has `getLocale`, `setLocale` and the URL helpers. Beyond `compile` and `watch`:
- `grai check` reports problems, unused keys and untranslated ones, without writing anything;
- `grai add` adds a key to every catalog at once;
- `grai find`, `grai rename` and `grai check --fix` find a key's call sites, rename a key in every catalog and call site, and remove the keys no source names;
- `grai seed`, `grai export` and `grai merge` take a locale's messages to translators as XLIFF 2.0, and their translations back;
- `grai help` lists every command.

### Vite

```ts
// vite.config.ts
import { grai } from "grai/vite";

export default { plugins: [grai()] };
```

The plugin compiles when Vite starts. In dev, it patches an edited message into the open page without a reload. In a build, each chunk holds only the keys its code uses, once per locale.

### SvelteKit

`grai/sveltekit` is in review (#11).

### Next.js

`grai/next` is in review (#29).

### A plain server or Workers

The output's `server.js` finds each request's locale by the config's `strategy` (`cookie`, `preferredLanguage`, `url`), and binds it for everything the handler calls:

```ts
// src/worker.ts
import { m } from "./lib/i18n/messages.js";
import { middleware } from "./lib/i18n/server.js";

export default {
	fetch: (request: Request) =>
		middleware(request, () => new Response(m.cart_title())),
};
```

It needs `node:async_hooks`, which Node, Deno, Bun and Workers with `nodejs_compat` have.

### Tests

A browser test sets the locale it expects in `beforeEach`, with `setLocale(locale, { reload: false })`. That sets `<html lang>` and `dir`, and the locale the next messages render in. The runtime reads `<html lang>` only once, when it loads, so a test that changes `lang` itself leaves the locale as it was.

## Config

The config's fields, and what each accepts, are being documented alongside the config's validation, which is still in progress.

## Measured

These numbers come from the catalogs of two real apps, compared with Paraglide 2.29.1:
- app A (SvelteKit, 6,379 keys × 3);
- app B (13,326 keys × 3).

They were taken on an M-series Mac; `docs/runtime.md` explains how to run the benches.

| | app A, Paraglide → grai | app B, Paraglide → grai | Reproduced by |
| --- | --- | --- | --- |
| Full compile | 51 s → 0.15 s | 20.9 s → 0.25 s | `bench/compile-time.mjs` |
| Compile with nothing changed | 44.6 s → 0.06 s | | `bench/compile-time.mjs` |
| One message edited, compiled | | 20.9 s → 0.20 s | `bench/compile-time.mjs` |
| Dev server, cold start | 85 s → 8 s | | the app's own `vite dev` |
| One message edited, until the page shows it | 41.6 s → 0.9 s | | the app's own `vite dev` |

App A's Paraglide compile includes the TypeScript declarations that its `sync` writes; app B's does not.

At runtime, on app A's catalogs, compared with Paraglide, i18next 26.4 and use-intl 4.14. The server rows time a prototype of grai's dispatcher (`bench/prototype.mjs`) until `bench/` runs grai's own output:

| | grai | Paraglide | i18next | use-intl | `bench/` |
| --- | --- | --- | --- | --- | --- |
| A text message on the server | 16 ns | 17–33 ns | 1.2–1.9 µs | 2.4–3.1 µs | `server` |
| Server render of 2,000 messages | 0.15–0.16 ms | 0.18–0.21 ms | 4.2 ms | 5.7–6.2 ms | `ssr` |
| Hydrating that page | 7.6 ms | 10.7 ms | 16.1 ms | 22.3 ms | `hydrate` |
| That page's JS, brotli | 22.7 KB | 38.6 KB | 125.2 KB | 122.6 KB | `hydrate` |
| The runtime in the browser, brotli | 0.5 KB | 3.6 KB | 12.1 KB | 10.2 KB | `library-bytes` |
| A new server process: load, then first render | 24 + 3 ms | 56 + 2 ms | 14 + 12 ms | 13 + 27 ms | `startup` |
| Type checking 500 calls with `tsc` 7 | 82 ms | 278 ms | 609 ms | 521 ms | `types` |
| The editor's first completion of a key | 0.2 s | 1.0 s | 49 s | 21 s | `types` |

## Limitations

- **A new server process loads grai's messages more slowly than i18next or use-intl:** 24 ms, against 13–14 ms on app A (`startup`), because V8 reads compiled functions more slowly than strings. grai's faster first render makes up most of it, but the gap is still open.
- **A SvelteKit page still loads every locale's message chunks.** That lasts until the adapter writes the import map that points each page at its own locale's copies.
- **Not supported yet:**
  - ordinal plurals;
  - selecting on a formatted value;
  - `:percent`, `:currency` and `:unit` (`:number style=percent` and `style=currency` work);
  - markup options and attributes;
  - nested keys in a catalog, which `grai import` flattens.

  Each is a compile error that names the construct, never an approximation. `docs/followups.md` tracks them.

## Coming from Paraglide or i18next

Paraglide's inlang message-format catalogs compile unchanged, and its calls stay the same: `m.key(inputs, { locale })`. Three things differ at a call site:

- **A message without inputs takes none.** `m.cart_title({ count })` is a type error, where Paraglide accepts it. An input a message never reads is a mistake at the call: a wrong key, or a placeholder a translation lost.
- **A key missing from any locale fails the compile.** No page ships another locale's words, or a key's name, in its place.
- **In the browser, `{ locale }` must be the page's locale.** A built page is meant to hold only its own locale's words, so a call in another throws `locale-not-loaded`, in dev and tests as in a build.

From i18next or ICU MessageFormat (next-intl, react-intl), `grai import --from i18next|icu <dir>` writes new grai catalogs.
- **Converted:** plurals, selects, nested keys, tags, ICU's `#` and its `number`, `date` and `time` arguments, and i18next's `number` and `datetime` formats.
- **Left out:** anything else, from every locale, and named in the report.

A key becomes its path joined by `_`, so `t("cart.title")` becomes `m.cart_title()`.

## License

MIT
