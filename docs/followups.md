# Follow-ups

Open work that `docs/design.md` leaves to measurement or to a later change.

## Ship one locale per page through an import map

The Vite plugin writes each message chunk once per locale under `grai-<locale>/` (`docs/design.md`). The SvelteKit adapter still has to write the import map to the page's locale and point Kit's `modulepreload` links at the copies.

Done when: `grai/sveltekit` does both, with a browser test that a page of the example loads no other locale's words and no shared message chunk.

## Switch locale in place: `"switch": "live"`

The config accepts `"live"`, and `grai/svelte` then keeps every message a call, but no page switches in place yet. `docs/design.md` has the design: `setLocale(locale, { reload: false })` loads the target locale's message chunks, switches, and the app re-renders. Switching in place costs the target locale's chunks and one mount of the page, 2.3 ms for 2,000 messages (10.2 ms at a 4× CPU slowdown, `hydrate`); a reload costs a server render, the page's data and a hydration.

Done when: under `"live"`, a page re-renders in the locale it switches to, and a browser test shows that a production build and dev switch the same way.

## `setLocale(locale, { reload: false })` as its type says

`runtime.d.ts` types `setLocale` by the config's `switch`: `void` under `"reload"`, where `{ reload: false }` only keeps the choice for the next load, and `Promise<void>` under `"live"`, resolving once the locale's message chunks are in. The runtime still sets `<html lang>` and `dir` under both, renders the messages called next in the new locale, and returns nothing.

Done when: under `"reload"`, `{ reload: false }` keeps the choice and leaves the page's messages as they are; under `"live"`, it returns that promise (the entry above); and a browser test shows each.
## Decide whether to inline text into Svelte's templates

Text inlined into a template before Svelte compiles it is static to Svelte: on the page of 2,000 calls it hydrates in 12.5–12.9 ms against 15.9–16.2 ms for `grai/svelte`'s strings at a 4× CPU slowdown (`docs/runtime.md`). It needs a step before Svelte's compile, and a copy per locale of every component chunk with such a text, behind the import map. Svelte trims the whitespace at the edges of an element's text, so a text's own edge whitespace has to stay an expression, `{" "}`.

Done when: it is measured on app A's real pages against `grai/svelte` (the time until hydrated at full speed and at a 4× slowdown, the page JS, and the build time and files with the copies), with each page's text compared exactly, and the design records the decision.

## A dispatcher per key for a message with inputs

Every message with inputs or markup dispatches through the runtime's one `message()` closure. V8 gives every closure of that literal one feedback vector, so its call of the locale's function sees every key's function and goes megamorphic. A call with inputs then costs 18–19 ns in a page against 11.7–12.3 ns for Paraglide's given `{ locale }` (`client`), and 110–130 ns against 67–122 ns on the server (`server`). An experiment outside `bench/`, which rewrote each such key's dispatch on the compiled output as a function of its own, took app A's call to 10.2 ns from 19.7 in Chromium, and to 43 ns from 53 in a request. A text message calls nothing through the dispatcher and keeps it.

Done when: each message with inputs or markup has a dispatcher of its own, on the server inside the server build's shape, and the server's load, a page's bytes, hydration and the call are measured on both reference apps against the shared dispatcher, the calls winning without the load or the bytes losing more.

## Bound the formatters kept per value an input gives

`formatterFor` keeps an Intl formatter for each value an input gives an option, in a map that nothing empties. Intl takes any well-formed three-letter currency code, and any offset time zone such as `+05:31`. So a server that formats a currency or a zone a request names can be made to keep up to 17,576 currency formatters, or 2,879 zone formatters, for each such formatter and locale. An app's own data names a few dozen values: Intl knows 162 currencies and 418 time zones by name. A formatter's memory sits mostly outside V8's heap, in ICU, so the heap does not show it.

Done when: the map keeps a fixed number of values at most, dropping the oldest first. The number is chosen by measuring a formatter's resident memory and the cost of making one again, and a test shows that a value dropped and asked for again still formats.

## Function expressions on a server without Vite

The Vite plugin's server build writes each message function as a function expression, which V8 only pre-parses, and loads app A's messages in 24–25 ms against 30 ms with arrows (`startup`). `keys.js` still writes arrows, and a server that loads it without the Vite plugin, such as a Next.js server bundle or a plain Node server, pays the difference.

Done when: such a server loads function expressions while the browser keeps arrows, and `startup`'s row for the compiler's output shows the gain.

## Support the MessageFormat 2 constructs that are still compile errors

These are compile errors today:
- selecting on a `:number` local whose options change its digits (`maximumFractionDigits`, significant digits, rounding, `notation`, `style`), which MessageFormat 2 selects on by the number those digits show;
- `:unit`'s `usage`, which converts the value into the locale's preferred units and which Intl cannot do;
- `:relativetime`'s unit taken from an input, such as Paraglide's `unit=$unit`. Intl takes the unit with each value, so it needs no formatter per value, but a unit Intl refuses must still throw a `GraiError` that names it.

Neither reference app uses them, but they are common in MessageFormat 2 catalogs, so other adopters will meet these errors first.

Done when: each compiles, with a test, and the design lists it among the constructs.

## The output under `noPropertyAccessFromIndexSignature`

The keys' code reads an input as `i.count`, and the inputs it is given are typed by an index signature, so an app whose checkJs sets `noPropertyAccessFromIndexSignature`, as @tsconfig/strictest does, gets an error at every read. `i["count"]` costs three bytes a read where a minifier does not run, as in a server build; taking the inputs apart in the parameter is shorter, but reads every input a locale's variants name on every call.

Done when: the checkJs test sets it too and passes, with the startup and bytes numbers of the chosen form.

## Bind the locale in Next.js server components

Next renders server components outside the middleware's call, so an `AsyncLocalStorage` binding set there does not reach them.

Done when: the Next adapter binds the locale per request (React's request scope or Next's own), and a test renders two interleaved requests in different locales.

## Prove the design on both reference apps

App A runs on grai, and the README cites its numbers. On the client, a forced `{ locale }` other than the current one throws, and every key must be in every locale; app B is not known to break either rule outside its tests.

Done when: a local branch of app B on grai passes its own checks and tests, and the README cites its cold `dev` and one-message edit times.

## A missing key's import in dev

`docs/design.md` says a per-key path to a key that does not exist resolves, in dev, to a module whose export throws a `GraiError` naming the key, with the key in the overlay. The Vite plugin does not yet: such an import fails when the page links its modules.

Done when: the Vite plugin serves that module and reports the key, with a test that a page importing a missing key loads and throws the `GraiError` only when the message is called.

## Import what `grai import` leaves out

It leaves out ICU's currency and skeleton styles, which need their options mapped one by one. vue-i18n's own syntax, with `|` plurals and `@:` links, is not ICU, and nothing reads it.

Done when: each converts, `bench/import-equivalence.mjs` covers it, and the design lists it.

## Localized pathnames

The `url` strategy prefixes a path with its locale and leaves the path as it is. A site that translates its paths (`/about` and `/de/ueber-uns`) for search engines cannot say so.

Done when: the config maps a path to its path in each locale, with named segments (`/products/[id]`), compiled into a table that `config.js` holds only when the config has one; `localizeHref`, `deLocalizeUrl` and the SvelteKit adapter's `reroute` follow it, and a test covers a translated path, a segment and an untranslated path.

## A domain per locale

A site served as `example.de` and `example.fr`, or `de.example.com`, names its locale by its host, which no strategy reads.

Done when: the config maps hosts to locales, the middleware reads the request's host, `localizeHref` to a locale on another host gives an absolute URL, local development has a documented way in without the production hosts, and a test covers each.

## The framework's base path

An app under a base path (SvelteKit's `paths.base`, Next's `basePath`) gets `/de/shop/about` from `localizeHref("/shop/about")`, not `/shop/de/about`. The framework owns the base path, so the config should not repeat it.

Done when: the Vite and Next adapters write the framework's base path into `config.js` at build, the URL helpers put the locale after it, and a test in each example covers a localized link under a base path.

## Paths the `url` strategy leaves alone

With the base locale unprefixed, `url` answers every path, so a site cannot localize its public pages by URL and its app (`/dashboard`) by cookie.

Done when: the config can name the paths `url` does not cover, the strategies after it then apply to those paths, and a test covers a covered and an uncovered path.

## Custom locale prefixes

A locale's prefix is its tag (`/en-US/…`). A site that wants `/us/…` cannot have it. Neither reference app needs it, so it waits for an adopter who does.

Done when: the config maps a locale to its prefix, and the URL helpers and the middleware follow it, with a test.

## Rename what a module reads off a dynamic import

`grai rename` refuses `(await import("…/messages/key.js")).key` and `module.key` after `const module = await import(…)`, since the scan does not follow a value. Both are rare outside tests.

Done when: a rename changes them, with a test of each.

## Export and seed a locale that falls back

`grai export en-GB --untranslated` lists every key en-GB takes from en as untranslated, so a translator is asked for all of en again; `grai seed en-GB` copies en's text into en-GB, which then no longer follows en. Both should treat a key a locale takes from its fallback as covered, and still let a translator give the locale its own text.

Done when: `export --untranslated` leaves out a key the locale takes from its fallback, a full export offers it with the fallback's text as its source, `seed` refuses a locale that falls back or seeds nothing it takes from its fallback, and a test covers each.
