# Migrating from Paraglide

Paraglide's catalogs compile unchanged, and so do its calls, `m.key(inputs, { locale })`. A migration changes a config file and the imports, then the call sites grai refuses, then the few messages whose output differs. There is no compatibility mode: each difference below has its rewrite.

## Steps

1. **The config.** Write `grai.config.json` from `project.inlang/settings.json`: its `locales` and `baseLocale`, its `pathPattern` as `catalogs`, Paraglide's output directory as `outdir`, and the server's `strategy` without `baseLocale`, which grai always falls back to. With the `cookie` strategy, `cookieName` is Paraglide's cookie, `PARAGLIDE_LOCALE` unless the app named another. grai refuses a strategy it does not have, such as `localStorage` or `custom-…`: the app chooses that locale itself, in the middleware's handler with `setLocale`.
2. **The plugin.** `paraglideVitePlugin(…)` becomes `grai()` from `@xyrolle/grai/vite`, or from `@xyrolle/grai/svelte` in a Svelte app.
3. **The imports.** `…/paraglide/messages.js` and `…/paraglide/runtime.js` become the outdir's `messages.js` and `runtime.js`, whose names are Paraglide's. A per-key import, `…/paraglide/messages/key.js`, maps to `keys.js` with one line in `package.json`'s `imports`, and the same in `tsconfig.json`'s `paths`, so TypeScript resolves it too:

   ```json
   { "imports": { "#i18n/messages/*": "./src/lib/i18n/keys.js" } }
   ```

4. **The server.** `paraglideMiddleware` becomes `middleware` from the outdir's `server.js`, with the same handler. It hands the handler the request as it came, not one with the locale's prefix taken off, so the framework routes through its own hook with `deLocalizeUrl`, such as SvelteKit's `reroute`: `({ url }) => deLocalizeUrl(url).pathname`.
5. **Tools that named Paraglide's modules** take grai's from `@xyrolle/grai/vite`'s `graiModules`, which gives the kind of each of grai's modules in a build.
6. **Not there yet:** Paraglide's `effectiveRequestUrl`, for a remote call to render in its page's locale under the `url` strategy.

## Call sites grai refuses

- **A message without inputs takes none.** `m.cart_title({ count })` is a type error, where Paraglide accepts it. An input a message never reads is a mistake at the call: a wrong key, or a placeholder a translation lost.
- **A key missing from any locale fails the compile.** No page ships another locale's words, or a key's name, in its place. A regional locale can take the messages it lacks from another of its language, with `"fallbacks": { "en-GB": "en" }`.
- **In the browser, `{ locale }` must be the page's locale.** A built page holds only its own locale's words, so a call in another throws `locale-not-loaded`, in dev and tests as in a build.
- **A nested key is called by its names joined by `_`:** `m.cart_title()` for `{ "cart": { "title": … } }`. Paraglide exports that name too, beside `m["cart.title"]`, which grai doesn't.

## Messages whose output differs

grai follows MessageFormat 2 and Intl where Paraglide does otherwise. Each of these compiles in both, and renders differently:

| A message or call | Paraglide | grai | The rewrite |
|---|---|---|---|
| `{d :time}` at 15:04:05 | `3:04:05 PM` | `3:04 PM`: MessageFormat 2's short time | `{d :time timeStyle=medium}` |
| `:date` or `:time` given an ISO string | parses it | throws `RangeError`: a date input is a `Date` or its time value, as its type says | pass `new Date(iso)` |
| a selector key `n=01` or `n=1.0`, given `1` | matches | `*`: a key matches `String(value)` | write the key as `String` gives it: `n=1` |
| a selector key `flag=true`, given `true` | `*` | matches, as `String(true)` is `true` | pass the value the variant is for, or drop the variant |
| selecting on `local f = n :number`, given `1000` | compares the formatted text, `1,000` | matches `f=1000`, then the plural category, then `*` | key the variants by the number, or its category: `f=one` |
| a date in a locale that falls back, `en-GB` to `en` | formats as `en` does, month first | formats as `en-GB` does: `02/01/2026` for 2 January | none: formatting and plurals follow the locale a message renders in |
| `localizeHref("/en/about", { locale: "de" })`, `en` the base locale | `/de/about` | `/de/en/about`: by default the base locale has no prefix, so `/en/…` is a path of its own | pass the path without it, `/about`; or, for a site whose base locale has a prefix too, `"localePrefix": "always"`, under which this gives `/de/about` |
| `localizeHref("https://…")` or `localizeHref("//…")` | localizes it | gives it back as it is, so no external link is rewritten | `localizeUrl(url, { locale })` for a URL meant to be localized |
| `de-at` against the locale `de-AT`, in a cookie or `assertIsLocale` | matches, ignoring case | refuses: locales compare exactly | `Intl.getCanonicalLocales(value)[0]` before it reaches grai |
