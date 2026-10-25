# Follow-ups

Open work that `docs/design.md` leaves to measurement or to a later change.

## Ship one locale per page through an import map

The Vite plugin writes each message chunk once per locale under `grai-<locale>/` (`docs/design.md`). The SvelteKit adapter still has to write the import map to the page's locale and point Kit's `modulepreload` links at the copies.

Done when: `grai/sveltekit` does both, with a browser test that a page of the example loads no other locale's words and no shared message chunk.

## Switch locale in place: `"switch": "live"`

The config accepts `"live"`, and `grai/svelte` then keeps every message a call, but no page switches in place yet. `docs/design.md` has the design: `setLocale(locale, { reload: false })` loads the target locale's message chunks, switches, and the app re-renders. Switching in place costs the target locale's chunks and one mount of the page, 2.3 ms for 2,000 messages (10.2 ms at a 4× CPU slowdown, `hydrate`); a reload costs a server render, the page's data and a hydration.

Done when: under `"live"`, a page re-renders in the locale it switches to, and a browser test shows that a production build and dev switch the same way.

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
- `:unit`'s `usage`, which converts the value into the locale's preferred units and which Intl cannot do.

Neither reference app uses them, but they are common in MessageFormat 2 catalogs, so other adopters will meet these errors first.

Done when: each compiles, with a test, and the design lists it among the constructs.

## Locals made from other locals

MessageFormat 2 lets a local be made from another, as in `local a = n: number` then `local b = a: integer`, and its functions compose: `b` takes `a`'s value and options, then its own. grai refuses such a local with an error naming both, and its message says to make it from the input instead.

Done when: a plural, formatted or `:string` local can be made from any other local, with the options composing as MessageFormat 2's functions do, its input typed and exported as the input it reads, and a test for each pairing.

## Bind the locale in Next's server actions and route handlers

React keeps no `cache` in a server action or a route handler, so there a message names its locale (`docs/design.md`). A form's error messages are the common case.

Done when: a server action and a route handler render messages in the request's locale without naming it, with a test in the Next example.

## Vary Next's responses by the headers the strategy reads

With the `cookie` or `preferredLanguage` strategy, grai/next's proxy answers one URL in several locales, and a page Next renders ahead of time is sent as cacheable. A shared cache keyed by the URL alone then serves the first reader's locale to everyone. The proxy's rewrite lists the headers it read in `Vary`, as grai's middleware writes it, but Next writes its own `Vary` for its RSC requests, and whether the page's response keeps the proxy's is not measured.

Done when: a page served through a shared cache renders in each reader's locale under those strategies, with a test.

## Ship one locale's client messages on Next.js

A client component's messages ship with every locale's variants: one Next build serves every locale, and Next gives an adapter no way to point a page at one locale's chunks. On the bench's page, grai costs 6.7 KB brotli more than the same page with its words written in, for 100 client messages in three locales and the runtime (`docs/runtime.md`).

Done when: a Next page's client chunks hold only its locale's variants, with a browser test that it loads no other locale's words.

## Make Next's first compile of a page cheaper

On the bench's page, `next dev`'s first response for the route takes longer with grai than with next-intl, from an empty `.next` and with it kept (`docs/runtime.md`): Turbopack compiles the whole output's 1.8 MB of message functions in each layer that imports them, server, server render and client, where next-intl's catalog is JSON.

Done when: a profile of that compile names where the time goes, and either a change brings it level with next-intl's or the design records why it stays.

## Report markup elements the base locale does not have

`Markup` throws for an element the app does not draw, and the app draws the base locale's. A translation that adds an element then throws in that locale only.

Done when: the compile, or `grai check`, reports a markup element that a locale names and the base locale does not.

## Prove the design on both reference apps

App A runs on grai, and the README cites its numbers. On the client, a forced `{ locale }` other than the current one throws, and every key must be in every locale; app B is not known to break either rule outside its tests.

Done when: a local branch of app B on grai passes its own checks and tests, and the README cites its cold `dev` and one-message edit times.

## Import what `grai import` leaves out

vue-i18n's own syntax, with `|` plurals and `@:` links, is not ICU, and nothing reads it. ICU's skeleton stems and date fields that Intl has no option for (`scale`, `integer-width`, weeks, quarters) are left out, as no import can express them.

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

## Rename what a module reads off a dynamic import

`grai rename` refuses `(await import("…/messages/key.js")).key` and `module.key` after `const module = await import(…)`, since the scan does not follow a value. Both are rare outside tests.

Done when: a rename changes them, with a test of each.

## Export and seed a locale that falls back

`grai export en-GB --untranslated` lists every key en-GB takes from en as untranslated, so a translator is asked for all of en again; `grai seed en-GB` copies en's text into en-GB, which then no longer follows en. Both should treat a key a locale takes from its fallback as covered, and still let a translator give the locale its own text.

Done when: `export --untranslated` leaves out a key the locale takes from its fallback, a full export offers it with the fallback's text as its source, `seed` refuses a locale that falls back or seeds nothing it takes from its fallback, and a test covers each.

## Descriptors `defineMessages` names, in `grai migrate`

react-intl apps often write their descriptors once, `const messages = defineMessages({ title: { id: "shop.title", defaultMessage: "Shop" } })`, and call `intl.formatMessage(messages.title)` or `<FormattedMessage {...messages.title} />`. `grai migrate` lists those calls, although a `const` that `defineMessages` initializes with the ids written in it names each message as plainly as a descriptor written in the call.

Done when: `grai migrate` rewrites both calls of such a `const` in the module that declares it, and removes the `const` once nothing reads it.

## Calls that render markup, in `grai migrate`

`<Trans>`, next-intl's `t.rich` and `t.markup`, and a react-intl message with markup are listed for a person, who renders the message's `.parts()`. A framework's markup component, such as `grai/react`'s `Markup`, would take the tags' renderers the call passes.

Done when: `grai migrate` rewrites a call whose tags each render one element of the call's own as that component's call, and a test renders it as the library did.

## A component's script, in `grai migrate`

`grai migrate` lists each Svelte, Vue, Astro or MDX component that imports the library, and rewrites none: its markup calls messages too, outside what an ES module parser reads.

Done when: `grai migrate` rewrites the calls in a component's script, and lists each one its markup makes.
