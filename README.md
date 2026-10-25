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
	"$schema": "./node_modules/grai/config.schema.json",
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

`grai compile` writes the output; `grai watch` writes it again on each edit. The output has a `.gitignore` of its own, so Git, Prettier and Biome skip it; ESLint needs the outdir in its `ignores`. Each message becomes a typed function:

```ts
import { m } from "./src/lib/i18n/messages.js";

m.cart_title(); // "Your cart"
m.cart_title({}, { locale: "de" }); // the German text
m.cart_total({ amount: 12.5 }); // "Total €12.50"
```

`runtime.js` beside it has `getLocale`, `setLocale` and the URL helpers; `docs/api.md` lists the whole API. Beyond `compile` and `watch`:
- `grai check` reports problems, unused keys and untranslated ones, without writing anything. A key that only tests name is unused; the config's `tests` globs say which files are tests;
- `grai add` adds a key to every catalog that lacks it, at once;
- `grai find`, `grai rename` and `grai check --fix` find a key's call sites, rename a key in every catalog and call site, and remove the keys no source names;
- `grai seed`, `grai export` and `grai merge` take a locale's messages to translators as XLIFF 2.0, and their translations back;
- `grai help` lists every command.

A `"pseudoLocale"` in the config, such as `"en-XA"`, is the base's messages accented, about 35% longer and in brackets, for finding text that bypasses the catalogs and layouts that break. `grai watch` and the Vite dev server compile it; `grai compile` and builds never do.

### Vite

```ts
// vite.config.ts
import { grai } from "grai/vite";

export default { plugins: [grai()] };
```

The plugin compiles when Vite starts. In dev, it patches an edited message into the open page without a reload. In a build, a page loads the keys its code uses in few chunks, each copied once per locale: keys the same pages use share a chunk, and small sets of them are pooled (`docs/design.md`).

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

`grai/sveltekit`'s `handleLocale` renders each request in its locale, from the output's middleware and text direction. `examples/sveltekit` is a complete app.

```ts
// src/hooks.server.ts
import { handleLocale } from "grai/sveltekit";
import { getTextDirection } from "#lib/i18n/runtime.js";
import { middleware } from "#lib/i18n/server.js";

export const handle = handleLocale({ middleware, getTextDirection });
```

It resolves the locale by `grai.config.json`'s `strategy` and binds it while the request renders. It writes the locale into `src/app.html`'s `%grai.lang%` and `%grai.dir%`:

```html
<html lang="%grai.lang%" dir="%grai.dir%">
```

The browser takes the page's `<html lang>` as its locale, so it hydrates in the words the server drew. With the `url` strategy, Kit routes a path without its locale prefix:

```ts
// src/hooks.ts
import type { Reroute } from "@sveltejs/kit/hooks";
import { deLocalizeUrl } from "#lib/i18n/runtime.js";

export const reroute: Reroute = ({ url }) => deLocalizeUrl(url).pathname;
```

Links then name their locale with `localizeHref("/about")`.

### Next.js

`grai/next` binds the locale in Next's App Router: the proxy resolves it, server components bind it, and client components get it on the server from `LocaleProvider` and in the browser from `<html lang>`. A message call stays a plain function. `examples/next` is a complete app.

```ts
// next.config.ts: `next build` compiles the catalogs, `next dev` recompiles on each save
import { withGrai } from "grai/next/config";

export default withGrai({ /* the app's own config */ });
```

```ts
// src/proxy.ts
export { proxy } from "grai/next/proxy";

export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
```

The proxy resolves the locale by `grai.config.json`'s `strategy` and rewrites the request to the same path under `/<locale>`, so the pages live under `app/[locale]/`. The URL stays as the strategy has it: with `url`, `/about` for the base locale and `/ro/about` for the others.

```tsx
// src/app/[locale]/layout.tsx
import { bindLocale, LocaleProvider } from "grai/next";
import { getTextDirection, locales } from "@/i18n/runtime.js";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  bindLocale(locale);
  return (
    <html lang={locale} dir={getTextDirection()}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
```

- **Every page, layout and `generateMetadata` calls `bindLocale` before its messages.** Next renders them side by side, and a client navigation renders only some of them. A message before it throws, saying so.
- **Client components call messages as they are.** In the browser a page keeps the locale it was loaded in; a link into another locale loads that page, and `setLocale(locale)` switches to it.
- **Server actions and route handlers name the locale:** `m.saved({}, { locale })`. React keeps no request state there.
- **Per-key imports** (`import { title } from "#i18n/messages/title.js"`) map to the output's keys.js through package.json `imports`, as in the example.
- **A markup message** renders with `grai/react`'s `Markup`, in server and client components alike:

  ```tsx
  <Markup parts={m.terms.parts()} markup={{ link: (children) => <a href="/terms">{children}</a> }} />
  ```

On a page of 400 messages in a server component and 100 in a client component, the browser downloads 129.8 KB brotli against next-intl's 230.3 KB, or its 134.4 KB with the client's keys picked, and an edit to a catalog is written in about 27 ms, 20 of them waiting for the save to settle; the rest of the edit is Next's refresh (`bench/nextjs.mjs`, `docs/runtime.md`).

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

A test picks the locale it renders in with `useLocale` from the output's `testing.js`, in `beforeEach`. Then the messages called next render in it, and so does a component given that locale, which a page in another locale refuses. It sets `<html lang>` and `dir` too. The runtime reads `<html lang>` only once, when it loads, so a test that changes `lang` itself leaves the locale as it was. A build refuses `testing.js`.

```ts
import { useLocale } from "./src/lib/i18n/testing.js";

beforeEach(() => useLocale("de"));
```

## Config

`grai.config.json` is read by the CLI, the Vite plugin and the adapters alike. Paths in it are relative to it.

| Field | |
|---|---|
| `locales` | The project's locales, as BCP 47 tags in their canonical form: `en-US`, not `en-us`. |
| `baseLocale` | One of `locales`: the one the others are translated from, whose text the editor shows and `grai seed` copies, and the locale a request gets when its strategy finds none. |
| `catalogs` | Each locale's catalog, a path with `{locale}` in it. |
| `outdir` | Where the compiled output goes. |
| `strategy` | Optional. Where the server looks for a request's locale, in order: `cookie`, `preferredLanguage` (its `Accept-Language`), `url` (its first path segment; the base locale has no prefix). |
| `cookieName` | The cookie `cookie` reads and `setLocale` writes, when `strategy` lists `cookie`: a name RFC 6265 allows. A `__Secure-` or `__Host-` name makes the cookie Secure. |
| `cookieMaxAge` | Optional. The seconds a browser keeps the cookie, 400 days by default, which is the most a browser keeps one. |
| `cookieDomain` | Optional. A host whose subdomains share the cookie, such as `example.com`. Not with a `__Host-` name, which a browser keeps for one host. |
| `cookieSameSite` | Optional. `"lax"`, the default, `"strict"`, or `"none"` for a page embedded in another site's, which makes the cookie Secure. |
| `localePrefix` | Optional, with the `url` strategy. `"as-needed"`, the default: the base locale's paths have no prefix, so `url` comes last. `"always"`: every locale's paths have one, an unprefixed page is sent to the locale the strategies after `url` find, and `url` may come first. |
| `localePrefixes` | Optional, with the `url` strategy. A locale's prefix of its own, one lowercase path segment, such as `{ "en-US": "us" }`; a locale's prefix is otherwise its tag. |
| `unlocalizedPaths` | Optional, with the `url` strategy. Globs of the paths `url` leaves alone, such as `["/api/**"]`: they have no prefix, and the strategies after `url` find their locale. |
| `switch` | Optional. How a page changes locale: `"reload"`, the default, reloads it, and `"live"` changes it in place (`docs/design.md`). |
| `tests` | Optional. Globs, of `*`, `**`, `?` and `{a,b}`, of the source files that are tests, which `grai check` does not count as using a key. By default `**/*.{test,spec}.*`, `**/__tests__/**`, and the root's `test/**` and `tests/**`, since a folder named `tests` deeper down may ship, as a route does; `[]` makes no file a test. |
| `identicalToBase` | Optional. Per locale, the keys whose message rightly reads as the base locale's, such as a unit: `{ "de": ["unit_km"] }`. `grai check` and `grai export` take them as translated, and `grai check` reports one whose message is no longer the base text. |
| `fallbacks` | Optional. Each locale that takes the messages it lacks from another locale of its language: `{ "en-GB": "en" }`. Its catalog may then hold only the messages that differ. |
| `pseudoLocale` | Optional. A locale, such as `"en-XA"`, made from the base's messages for development and tests: accented, about 35% longer and in brackets. It needs the base's plural categories; `grai watch` and the Vite dev server compile it, and no build does. |
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
| The runtime in the browser, its whole API, brotli | 1.0 KB | 3.6 KB | 12.1 KB | 10.2 KB | `library-bytes` |
| A new server process: load, then first render | 25 + 4 ms | 54 + 2 ms | 16 + 11 ms | 16 + 25 ms | `startup` |
| Type checking 500 calls with `tsc` 7 | 82 ms | 278 ms | 609 ms | 521 ms | `types` |
| The editor's first completion of a key | 0.2 s | 1.0 s | 49 s | 21 s | `types` |

## Limitations

- **A new server process loads grai's messages more slowly than i18next or use-intl:** 25 ms, against 16 ms on app A (`startup`). V8 reads functions more slowly than strings, even the function expressions of grai's server build, which it only pre-parses. grai's faster first render makes up most of it, but the gap is still open. With Node's compile cache (`module.enableCompileCache()`), grai's load takes 11–14 ms.
- **A message with inputs costs more than Paraglide's call given `{ locale }`:** 18–19 ns in a page against 11.7–12.3 ns (`client`), and on the server 110–130 ns against 67–122 ns (`server`). Every such message dispatches through one shared closure, so its call of the locale's function goes megamorphic. A dispatcher per key is the fix, tracked in `docs/followups.md`.
- **A SvelteKit page still loads every locale's message chunks.** That lasts until the adapter writes the import map that points each page at its own locale's copies.
- **Not supported yet:**
  - `:unit`'s `usage`, which converts to the locale's units;
  - an option's value taken from an input, other than a currency, a unit and a time zone (`currency=$code` and `:relativetime`'s `unit=$unit` work), such as `style=$style`.

  Each is a compile error that names the construct, never an approximation. `docs/followups.md` tracks them.

## Coming from Paraglide or i18next

Paraglide's inlang message-format catalogs compile unchanged, and its calls stay the same: `m.key(inputs, { locale })`. Four things differ at a call site:

- **A message without inputs takes none.** `m.cart_title({ count })` is a type error, where Paraglide accepts it. An input a message never reads is a mistake at the call: a wrong key, or a placeholder a translation lost.
- **A key missing from any locale fails the compile.** No page ships another locale's words, or a key's name, in its place. A regional locale can still take the messages it lacks from another of its language, with `"fallbacks": { "en-GB": "en" }`.
- **In the browser, `{ locale }` must be the page's locale.** A built page is meant to hold only its own locale's words, so a call in another throws `locale-not-loaded`, in dev and tests as in a build.
- **A nested key is called by its names joined by `_`:** `m.cart_title()` for `{ "cart": { "title": … } }`. Paraglide exports that name too, beside `m["cart.title"]`, which grai doesn't.

From i18next or ICU MessageFormat (next-intl, react-intl), `grai import --from i18next|icu <dir>` writes new grai catalogs.
- **Converted:** plurals, ordinals, selects, nested keys, tags, ICU's `#` and its `number`, `date` and `time` arguments with their styles and skeletons, and i18next's built-in formats with their options: `number`, `currency`, `datetime`, `relativetime` and `list`.
- **Left out:** anything else, from every locale, and named in the report.
- **Kept beside them:** FormatJS's descriptions, in the file the config's `descriptions` names.

From Lingui's PO catalogs, have Lingui write them as JSON instead, with its `@lingui/format-json` format and `style: "minimal"`: each message id then maps to its ICU message, which `--from icu` imports. A message's id becomes its key, so the messages need explicit ids, such as `cart.title`, not ids made from their text.

A key becomes its path joined by `_`, so `t("cart.title")` becomes `m.cart_title()`. The import writes `grai.import.json` beside the config, mapping each key as the source's calls name it, an i18next namespace included (`common:cart.title`), to its grai key and the inputs it takes. `grai migrate` then rewrites each call that names its message plainly, from i18next, react-i18next, next-intl or react-intl, and lists every other call for a person: [docs/migrating.md](docs/migrating.md).

## License

MIT
