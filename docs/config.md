# Config

`grai.config.json` is read by the CLI, the Vite plugin and the adapters alike. Paths in it are relative to it.

| Field | |
|---|---|
| `locales` | The project's locales, as BCP 47 tags in their canonical form: `en-US`, not `en-us`. |
| `baseLocale` | One of `locales`: the one the others are translated from, whose text the editor shows and `grai seed` copies, and the locale a request gets when its strategy finds none. |
| `catalogs` | Each locale's catalog, a path with `{locale}` in it, or a list of such paths, where a locale's messages are split across files, such as `["messages/{locale}.json", "messages/admin/{locale}.json"]`: a key is in one of its locale's files, and a new key goes in the first. |
| `outdir` | Where the compiled output goes. |
| `strategy` | Optional. Where the server and a page no server draws look for the locale, in order: `cookie`, `localStorage` (the page's alone), `query` (a query parameter), `preferredLanguage` (the request's `Accept-Language`, the browser's languages), `url` (the first path segment; the base locale has no prefix), or a strategy the server defines, named `custom-` and a lowercase name, such as `custom-session`, which `defineServerStrategy` from the output's `server.js` defines and a page does not read. |
| `cookieName` | The cookie `cookie` reads and `setLocale` writes, when `strategy` lists `cookie`: a name RFC 6265 allows. A `__Secure-` or `__Host-` name makes the cookie Secure. |
| `cookieMaxAge` | Optional. The seconds a browser keeps the cookie, 400 days by default, which is the most a browser keeps one. |
| `cookieDomain` | Optional. A host whose subdomains share the cookie, such as `example.com`. Not with a `__Host-` name, which a browser keeps for one host. |
| `cookieSameSite` | Optional. `"lax"`, the default, `"strict"`, or `"none"` for a page embedded in another site's, which makes the cookie Secure. |
| `localStorageKey` | The key in `localStorage` that `localStorage` reads and `setLocale` writes, when `strategy` lists `localStorage`. |
| `queryParameter` | The query parameter `query` reads and `setLocale` names the locale in, when `strategy` lists `query`. |
| `localePrefix` | Optional, with the `url` strategy. `"as-needed"`, the default: the base locale's paths have no prefix, so `url` comes last. `"always"`: every locale's paths have one, an unprefixed page is sent to the locale the strategies after `url` find, and `url` may come first. |
| `localePrefixes` | Optional, with the `url` strategy. A locale's prefix of its own, one lowercase path segment, such as `{ "en-US": "us" }`; a locale's prefix is otherwise its tag. |
| `unlocalizedPaths` | Optional, with the `url` strategy. Globs of the paths `url` leaves alone, such as `["/api/**"]`: they have no prefix, and the strategies after `url` find their locale. |
| `pathnames` | Optional, with the `url` strategy. A route's path in each locale's words, with named segments: `{ "/about": { "de": "/ueber-uns" }, "/products/[id]": { "de": "/produkte/[id]" } }`. `localizeHref` writes it, and `deLocalizeUrl` reads it back as the route, so a SvelteKit `reroute` and Next's proxy serve it; Astro's middleware renders it on demand, and a static build writes each prerendered page there too; @xyrolle/grai/nuxt routes each page's copies at its words. |
| `basePath` | Optional, with the `url` strategy. The path the app is served under, such as `"/shop"`, which the locale's prefix follows: `/shop/de/about`. The framework's base path must be the same, and each adapter refuses another: Vite's `base`, SvelteKit's `paths.base`, Next's `basePath`, Astro's `base`, Nuxt's `app.baseURL`. |
| `domains` | Optional, with the `url` strategy. Every locale's own host, such as `{ "en": "example.com", "de": "example.de" }`: there a request's host names its locale, paths have no prefix, and `localizeHref` to a locale on another host gives a whole URL. On any other host, such as `localhost` in development, the prefix names the locale, so every locale is reached without the production hosts. |
| `switch` | Optional. How a page changes locale: `"reload"`, the default, reloads it. `"live"`, where it changes in place, is refused until grai does it (`docs/followups.md`). |
| `tests` | Optional. Globs, of `*`, `**`, `?` and `{a,b}`, of the source files that are tests, which `grai check` does not count as using a key. By default `**/*.{test,spec}.*`, `**/__tests__/**`, and the root's `test/**` and `tests/**`, since a folder named `tests` deeper down may ship, as a route does; `[]` makes no file a test. |
| `identicalToBase` | Optional. Per locale, the keys whose message rightly reads as the base locale's, such as a unit: `{ "de": ["unit_km"] }`. `grai check` and `grai export` take them as translated, and `grai check` reports one whose message is no longer the base text. |
| `fallbacks` | Optional. Each locale that takes the messages it lacks from another locale of its language: `{ "en-GB": "en" }`. Its catalog may then hold only the messages that differ. |
| `pseudoLocale` | Optional. A locale, such as `"en-XA"`, made from the base's messages for development and tests: accented, about 35% longer and in brackets. It needs the base's plural categories; `grai watch` and the Vite dev server compile it, and no build does. |
| `descriptions` | Optional. A JSON file of each key's description for translators, such as `{ "open": "A verb: the button opens the menu" }`. `grai export` writes each as a note of the key's units, `grai import` fills it from FormatJS's descriptions, and `grai rename` and `grai check --fix` keep it in step. |
