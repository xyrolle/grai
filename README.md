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
- `grai check` reports problems, unused keys and untranslated ones, without writing anything. A key that only tests name is unused; the config's `tests` globs say which files are tests;
- `grai add` adds a key to every catalog that lacks it, at once;
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

A tool that reads a client build's chunks can ask which of grai's modules an id is, rather than spell grai's module ids:

```ts
import { graiModules } from "grai/vite";

const kindOf = graiModules(); // reads grai.config.json
kindOf(id); // "runtime", "config", "plurals", "formats" (the grai-runtime chunk), "key" or "text" (a message chunk), or undefined
```

### Svelte

In a Svelte or SvelteKit app, take the plugin from `grai/svelte`, listed before Svelte's:

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { grai } from "grai/svelte";

export default { plugins: [grai(), sveltekit()] };
```

It is `grai/vite`'s plugin, and in the client build a component's call of a message without inputs, such as `{m.title()}`, reads that message's string in the page's locale. Svelte draws a string as a plain value, where it gives each call a signal of its own, so a page of 2,000 messages with app A's catalog hydrates in two-thirds of the time (`docs/runtime.md`). The app needs `svelte` and `magic-string`. With `"switch": "live"` in the config, for a page that changes locale in place, every call stays a call.

### SvelteKit

`grai/sveltekit` is in review (#11).

### Next.js

`grai/next` is in review (#29).

### Workers, Bun, Deno and Node

The output's `server.js` finds each request's locale by the config's `strategy` (`cookie`, `preferredLanguage`, `url`), binds it for everything the handler calls, and lists in the response's `Vary` the request headers it read, so a shared cache keeps a copy per locale:

```ts
// src/worker.ts
import { m } from "./lib/i18n/messages.js";
import { middleware } from "./lib/i18n/server.js";

export default {
	fetch: (request: Request) =>
		middleware(request, () => new Response(m.cart_title())),
};
```

Workers, Bun (`bun src/worker.ts`) and Deno (`deno serve src/worker.ts`) serve this module as it is. `examples/workers` is a complete Worker, and `test/workers.test.ts` serves it in all three. In Hono, which also runs on Node, the middleware is one line:

```ts
app.use((c, next) => middleware(c.req.raw, () => next().then(() => c.res)));
```

It needs `AsyncLocalStorage`, from `node:async_hooks`, which Node, Bun and Deno have. Workers have it by default from compatibility date 2026-08-04; on an earlier date, add the `nodejs_als` compatibility flag, which adds only that.

### Tests

A browser test sets the locale it expects in `beforeEach`, with `setLocale(locale, { reload: false })`. That sets `<html lang>` and `dir`, and the locale the next messages render in. The runtime reads `<html lang>` only once, when it loads, so a test that changes `lang` itself leaves the locale as it was.

## Config

`grai.config.json` is read by the CLI, the Vite plugin and the adapters alike. Paths in it are relative to it.

| Field | |
|---|---|
| `locales` | The project's locales, as BCP 47 tags in their canonical form: `en-US`, not `en-us`. |
| `baseLocale` | One of `locales`: the one the others are translated from, whose text the editor shows and `grai seed` copies, and the locale a request gets when its strategy finds none. |
| `catalogs` | Each locale's catalog, a path with `{locale}` in it. |
| `outdir` | Where the compiled output goes. |
| `strategy` | Optional. Where the server looks for a request's locale, in order: `cookie`, `preferredLanguage` (its `Accept-Language`), `url` (its first path segment; the base locale has no prefix). |
| `cookieName` | The cookie `cookie` reads and `setLocale` writes, when `strategy` lists `cookie`: a name RFC 6265 allows. |
| `switch` | Optional. How a page changes locale: `"reload"`, the default, reloads it, and `"live"` changes it in place (`docs/design.md`). |
| `tests` | Optional. Globs, of `*`, `**`, `?` and `{a,b}`, of the source files that are tests, which `grai check` does not count as using a key. By default `**/*.{test,spec}.*`, `**/__tests__/**`, and the root's `test/**` and `tests/**`, since a folder named `tests` deeper down may ship, as a route does; `[]` makes no file a test. |
| `identicalToBase` | Optional. Per locale, the keys whose message rightly reads as the base locale's, such as a unit: `{ "de": ["unit_km"] }`. `grai check` and `grai export` take them as translated, and `grai check` reports one whose message is no longer the base text. |
| `fallbacks` | Optional. Each locale that takes the messages it lacks from another locale of its language: `{ "en-GB": "en" }`. Its catalog may then hold only the messages that differ. |
| `descriptions` | Optional. A JSON file of each key's description for translators, such as `{ "open": "A verb: the button opens the menu" }`. `grai export` writes each as a note of the key's units, `grai import` fills it from FormatJS's descriptions, and `grai rename` and `grai check --fix` keep it in step. |

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

At runtime, on app A's catalogs, compared with Paraglide, i18next 26.4 and use-intl 4.14. grai's rows run its own output: on the server as its Vite plugin builds it, and in a page as its client build ships it, with the page's locale copies. Paraglide's call in a page runs its strategy each time; given `{ locale }`, it takes the second figure:

| | grai | Paraglide | i18next | use-intl | `bench/` |
| --- | --- | --- | --- | --- | --- |
| A text message on the server | 19–25 ns | 46–50 ns | 1.4–1.8 µs | 2.7–3.2 µs | `server` |
| A text message in a page | 4.4–4.8 ns | 361–394 ns; 4.5–5.9 ns | 1.0–1.1 µs | 1.3–1.5 µs | `client` |
| A message with inputs in a page | 18–19 ns | 366–392 ns; 11.7–12.3 ns | 2.1–2.2 µs | 1.4–1.5 µs | `client` |
| Server render of 2,000 messages | 0.13 ms | 0.20–0.23 ms | 3.9 ms | 4.8–5.0 ms | `ssr` |
| Hydrating that page | 5.4–6.9 ms | 7.9–10.4 ms | 12.2–15.6 ms | 16.7–21.6 ms | `hydrate` |
| That page's JS, brotli | 22.9–24.9 KB | 38.0–40.5 KB | 125–133 KB | 125–133 KB | `hydrate` |
| The runtime in the browser, brotli | 0.5 KB | 3.6 KB | 12.1 KB | 10.2 KB | `library-bytes` |
| A new server process: load, then first render | 25 + 4 ms | 54 + 2 ms | 16 + 11 ms | 16 + 25 ms | `startup` |
| Type checking 500 calls with `tsc` 7 | 82 ms | 278 ms | 609 ms | 521 ms | `types` |
| The editor's first completion of a key | 0.2 s | 1.0 s | 49 s | 21 s | `types` |

## Limitations

- **A new server process loads grai's messages more slowly than i18next or use-intl:** 25 ms, against 16 ms on app A (`startup`). V8 reads functions more slowly than strings, even the function expressions of grai's server build, which it only pre-parses. grai's faster first render makes up most of it, but the gap is still open. With Node's compile cache (`module.enableCompileCache()`), grai's load takes 11–14 ms.
- **A message with inputs costs more than Paraglide's call given `{ locale }`:** 18–19 ns in a page against 11.7–12.3 ns (`client`), and on the server 110–130 ns against 67–122 ns (`server`). Every such message dispatches through one shared closure, so its call of the locale's function goes megamorphic. A dispatcher per key is the fix, tracked in `docs/followups.md`.
- **A SvelteKit page still loads every locale's message chunks.** That lasts until the adapter writes the import map that points each page at its own locale's copies.
- **Not supported yet:**
  - selecting on a `:number` whose options round it, such as `maximumFractionDigits`;
  - `:unit`'s `usage`, which converts to the locale's units;
  - an option's value taken from an input, other than a currency, a number's unit and a date's time zone (`currency=$code` works), such as `:relativetime`'s `unit=$unit`.

  Each is a compile error that names the construct, never an approximation. `docs/followups.md` tracks them.

## Coming from Paraglide or i18next

Paraglide's inlang message-format catalogs compile unchanged, and its calls stay the same: `m.key(inputs, { locale })`. Four things differ at a call site:

- **A message without inputs takes none.** `m.cart_title({ count })` is a type error, where Paraglide accepts it. An input a message never reads is a mistake at the call: a wrong key, or a placeholder a translation lost.
- **A key missing from any locale fails the compile.** No page ships another locale's words, or a key's name, in its place. A regional locale can still take the messages it lacks from another of its language, with `"fallbacks": { "en-GB": "en" }`.
- **In the browser, `{ locale }` must be the page's locale.** A built page is meant to hold only its own locale's words, so a call in another throws `locale-not-loaded`, in dev and tests as in a build.
- **A nested key is called by its names joined by `_`:** `m.cart_title()` for `{ "cart": { "title": … } }`. Paraglide exports that name too, beside `m["cart.title"]`, which grai doesn't.

From i18next or ICU MessageFormat (next-intl, react-intl), `grai import --from i18next|icu <dir>` writes new grai catalogs.
- **Converted:** plurals, ordinals, selects, nested keys, tags, ICU's `#` and its `number`, `date` and `time` arguments, and i18next's built-in formats with their options: `number`, `currency`, `datetime`, `relativetime` and `list`.
- **Left out:** anything else, from every locale, and named in the report.
- **Kept beside them:** FormatJS's descriptions, in the file the config's `descriptions` names.

From Lingui's PO catalogs, have Lingui write them as JSON instead, with its `@lingui/format-json` format and `style: "minimal"`: each message id then maps to its ICU message, which `--from icu` imports. A message's id becomes its key, so the messages need explicit ids, such as `cart.title`, not ids made from their text.

A key becomes its path joined by `_`, so `t("cart.title")` becomes `m.cart_title()`.

## License

MIT
