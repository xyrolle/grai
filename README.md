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

The plugin compiles when Vite starts. In dev, it patches an edited message into the open page without a reload. In a build, a page loads the keys its code uses in few chunks: keys the same pages use share a chunk, and small sets of them are pooled (`docs/design.md`). With `grai({ localeChunks: true })`, the client build also copies each of those chunks once per locale, for an adapter that points each page at its own locale's copies, as `grai/sveltekit` does.

A tool that reads a client build's chunks can ask which of grai's modules an id is, rather than spell grai's module ids:

```ts
import { graiModules } from "grai/vite";

const kindOf = graiModules(); // reads grai.config.json
kindOf(id); // "runtime", "config", "plurals", "formats" (the grai-runtime chunk), "key" or "text" (a message chunk), or undefined
```

### A static site, an Electron app or an extension

Where no server picks the locale, each page the plugin builds picks it itself, before any module loads, from the places the config's `strategy` lists, in order:

```json
{
	"strategy": ["query", "localStorage", "preferredLanguage"],
	"queryParameter": "lng",
	"localStorageKey": "locale"
}
```

- `cookie` (with `cookieName`) and `localStorage` (with `localStorageKey`) hold the visitor's choice, which `setLocale` writes;
- `query` (with `queryParameter`) is a link's `?lng=de`;
- `preferredLanguage` is the browser's languages, matched as the server matches `Accept-Language`: `de-AT` finds `de`;
- `url` is the path's first segment, `/de/cart`.

A server reads the same list where it can, so a page it draws picks the same locale. The page's `<html lang>`, as its template has it, is only a default; a server or a prerender that writes another locale's `lang` in its place drew the page in that one, and the page keeps it.

With `grai({ localeChunks: true })`, the page then loads only its locale's words: the build writes each message chunk's copy per locale, and the script points the page at its locale's. With a Content Security Policy that allows scripts by hash, add the hashes the build's log names to `script-src`; they change only with the config, Vite's `base` or grai. With Vite's `html.cspNonce`, nothing more is needed.

### Svelte

In a Svelte app, take the plugin from `grai/svelte`, listed before Svelte's, and in a SvelteKit app from `grai/sveltekit/vite` (below):

```ts
// vite.config.ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { grai } from "grai/svelte";

export default { plugins: [grai(), svelte()] };
```

It is `grai/vite`'s plugin, and in the client build a component's call of a message without inputs, such as `{m.title()}`, reads that message's string in the page's locale. Svelte draws a string as a plain value, where it gives each call a signal of its own, so a page of 2,000 messages with app A's catalog hydrates in two-thirds of the time (`docs/runtime.md`). The app needs `svelte` and `magic-string`. With `"switch": "live"` in the config, for a page that changes locale in place, every call stays a call.

### SvelteKit

`grai/sveltekit`'s `handleLocale` renders each request in its locale, from the output's middleware and text direction, and `grai/sveltekit/vite`'s plugin, listed before Kit's, builds the app. `examples/sveltekit` is a complete app.

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { grai } from "grai/sveltekit/vite";

export default { plugins: [grai(), sveltekit()] };
```

```ts
// src/hooks.server.ts
import { handleLocale } from "grai/sveltekit";
import { getTextDirection } from "#lib/i18n/runtime.js";
import { localeCopies, middleware } from "#lib/i18n/server.js";

export const handle = handleLocale({ middleware, getTextDirection, localeCopies });
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

Links then name their locale with `localizeHref("/about")`. A page holds its own locale's words, so a link to another locale's page must load it as a document, as Kit would otherwise draw it in the client with the first page's locale. The root layout says so, once, and a navigation within one locale stays Kit's:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
	import { reloadAcrossLocales } from "grai/sveltekit/navigation";
	import { localizeUrl } from "#lib/i18n/runtime.js";

	let { children } = $props();
	reloadAcrossLocales({ localizeUrl });
</script>

{@render children()}
```

A built page downloads only its own locale's words. The plugin is `grai/svelte`'s, and it also writes a copy of each message chunk per locale, which the output's `localeCopies` says; `handleLocale` then writes the page an import map from the shared chunks to its locale's copies, and points Kit's preloads at the copies. Built with any other plugin, `localeCopies` is false, and a page loads the shared chunks.

In dev, an edited message shows in the open page without a reload once `src/hooks.client.ts` imports `grai/sveltekit/client`. Svelte draws again only what read the edited keys, and the page's loads and remote functions run again for the text they return. A build leaves the module out.

```ts
// src/hooks.client.ts
import "grai/sveltekit/client";
```

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

### Astro

`grai/astro` is an Astro integration. It adds `grai/vite`, compiles the catalogs for `astro build`, and for `astro sync`, which `astro check` runs. It adds a middleware that renders each request in its locale, islands included. `examples/astro` is a complete site, static and rendered on demand.

```ts
// astro.config.ts
import { defineConfig } from "astro/config";
import { grai } from "grai/astro";

export default defineConfig({
	i18n: { locales: ["en", "ro", "ar"], defaultLocale: "en" },
	integrations: [grai()],
});
```

The middleware resolves the locale by `grai.config.json`'s `strategy` and binds it while the page renders. It writes the locale and its text direction to `<html lang>` and `dir`. The browser's runtime takes `<html lang>` as the page's locale, so a Svelte or React island hydrates in the words the server drew. In a build, each page loads only its own locale's copies of the message chunks, through an import map.

With Astro's i18n routing, the URL names each page's locale and Astro routes it. The pages live under `src/pages/[...locale]/`, or a folder per locale. `Astro.currentLocale` is the locale grai renders in, and `getRelativeLocaleUrl` links to each locale's page. The two configs must agree, and the build stops on any difference, saying what to set:

| Astro's `i18n` | grai's config |
|---|---|
| routing by the URL | `"url"` first in `"strategy"` |
| `locales: ["en", "ro"]` | `"locales": ["en", "ro"]` |
| `{ path: "romana", codes: ["ro"] }` | `"localePrefixes": { "ro": "romana" }` |
| `defaultLocale` | `"baseLocale"` |
| `routing.prefixDefaultLocale: true` | `"localePrefix": "always"`, with Astro's own routes in `"unlocalizedPaths"`: `/_image`, `/_server-islands/**`, `/404`, `/500` |
| a page outside the locales' paths | `"unlocalizedPaths"`, whose locale the strategies after `"url"` find |

A `base` and `domains` aren't supported yet.

A page whose locale comes from the request, through `cookie` or `preferredLanguage`, rather than from its URL, is rendered on demand. The build stops on a prerendered one, which would show every reader the one locale it was built in.

Under `<ClientRouter />`, a link into another locale needs `data-astro-reload`, so the page loads in its locale (`docs/followups.md`).

On a static site whose page renders 400 messages and a Svelte island 100, `astro build` takes 1.7 s against Paraglide's 6.0 s. The page downloads 22.1 KB against 25.4 KB, as its island loads only its own locale's words. In `astro dev`, an edited message the server renders shows in 84 ms. With Paraglide, the open page keeps its words until a reload by hand (`bench/astro.mjs`, `docs/runtime.md`).

### Workers, Bun, Deno and Node

The output's `server.js` finds each request's locale by the config's `strategy` (`cookie`, `query`, `preferredLanguage`, `url`), binds it for everything the handler calls, and lists in the response's `Vary` the request headers it read, so a shared cache keeps a copy per locale:

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

### Changing locale

`setLocale(locale)` keeps the visitor's choice in each place the strategy lists that holds one, its cookie, its key in `localStorage`, its query parameter or its path, and loads the page again in it. A page keeps its words while it lives, so `setLocale(locale, { reload: false })` only keeps the choice, for the page's next load. The browser's languages hold no choice, so a strategy must list one of those places for `setLocale` to change a page's locale; without one, a page would load in its old locale again, and `setLocale` throws a `GraiError` (`locale-unkept`) instead. A static app keeps the choice in `localStorage`, and an app a server draws in a cookie, which the server reads too:

```json
{
	"strategy": ["cookie", "preferredLanguage"],
	"cookieName": "lang"
}
```

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
| `switch` | Optional. How a page changes locale: `"reload"`, the default, reloads it. `"live"`, where it changes in place, is refused until grai does it (`docs/followups.md`). |
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
- **A Next app started on a loopback address, `127.0.0.1` or `[::1]`, never answers a page:** there Next 16.4 sends each of the proxy's rewrites back to itself, and grai/next's proxy rewrites each one again. Start Next on its default host, `0.0.0.0` or the machine's address, as behind a reverse proxy (`docs/followups.md`).
- **Under a CSP of hashes, a built SvelteKit page downloads its locale's message chunks and the shared ones.** The browser refuses the import map, which carries Kit's nonce but no hash yet. A CSP of nonces works, as Kit's `auto` mode gives a page it renders on request.
- **Not supported yet:**
  - `:unit`'s `usage`, which converts to the locale's units;
  - an option's value taken from an input, other than a currency, a unit and a time zone (`currency=$code` and `:relativetime`'s `unit=$unit` work), such as `style=$style`.

  Each is a compile error that names the construct, never an approximation. `docs/followups.md` tracks them.

## Coming from Paraglide or i18next

Paraglide's inlang message-format catalogs compile unchanged, and its calls stay the same: `m.key(inputs, { locale })`. [docs/migrating-from-paraglide.md](docs/migrating-from-paraglide.md) gives the steps, the call sites grai refuses, such as an input passed to a message that takes none, and the few messages whose output differs, each with its rewrite.

From i18next or ICU MessageFormat (next-intl, react-intl), `grai import --from i18next|icu <dir>` writes new grai catalogs.
- **Converted:** plurals with their offsets, ordinals, selects, nested keys, tags, ICU's `#` and its `number`, `date` and `time` arguments with their styles and skeletons, and i18next's built-in formats with their options: `number`, `currency`, `datetime`, `relativetime` and `list`.
- **Left out:** anything else, from every locale, and named in the report.
- **Kept beside them:** FormatJS's descriptions, in the file the config's `descriptions` names.

From Lingui's PO catalogs, have Lingui write them as JSON instead, with its `@lingui/format-json` format and `style: "minimal"`: each message id then maps to its ICU message, which `--from icu` imports. A message's id becomes its key, so the messages need explicit ids, such as `cart.title`, not ids made from their text.

A key becomes its path joined by `_`, so `t("cart.title")` becomes `m.cart_title()`. The import writes `grai.import.json` beside the config, mapping each key as the source's calls name it, an i18next namespace included (`common:cart.title`), to its grai key and the inputs it takes. `grai migrate` then rewrites each call that names its message plainly, from i18next, react-i18next, next-intl or react-intl, and lists every other call for a person: [docs/migrating.md](docs/migrating.md).

## License

MIT
