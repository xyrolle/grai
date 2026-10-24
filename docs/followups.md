# Follow-ups

Open work that `docs/design.md` leaves to measurement or to a later change.

## Ship one locale per page through an import map

The Vite plugin writes each message chunk once per locale under `grai-<locale>/` (`docs/design.md`). The SvelteKit adapter still has to write the import map to the page's locale and point Kit's `modulepreload` links at the copies.

Done when: `grai/sveltekit` does both, with a browser test that a page of the example loads no other locale's words and no shared message chunk.

## Decide how the client switches locale

A production page holds only its locale's words, and `setLocale(locale, { reload: false })` must behave the same in every build. The two options are in `docs/design.md`: load the target locale and then switch, or never switch within the page. Switching in place costs the target locale's chunks and one mount of the page, 2.3 ms for 2,000 messages (10.2 ms at a 4× CPU slowdown); a reload costs a server render, the page's data and a hydration.

Done when: the design records one option as a decision, and a browser test shows that a production build and dev switch the same way.

## Show a server text call at 20 ns or less

A text message called in a request reads the request's locale from `AsyncLocalStorage`. On a loaded machine that measured 24–27 ns, against 28–32 ns for the runtime lane's prototype run alongside, which measured 14–23 ns on a quiet one.

Done when: `bench/` runs grai's own output on a quiet machine and shows a text call in a request at 20 ns or less, or the design records why the floor is higher.

## Support ordinals, number selection, more functions and markup options

These are compile errors today:
- an ordinal plural, `local p = n: plural select=ordinal`;
- selecting on a `:number` local, which MessageFormat 2 does by plural category after an exact match;
- `:percent`, `:currency` and `:unit`;
- markup options and attributes.

Neither reference app uses them, but they are common in MessageFormat 2 catalogs, so other adopters will meet these errors first.

Done when: each compiles, with a test, and the design lists it among the constructs.

## Bind the locale in Next's server actions and route handlers

React keeps no `cache` in a server action or a route handler, so there a message names its locale (`docs/design.md`). A form's error messages are the common case.

Done when: a server action and a route handler render messages in the request's locale without naming it, with a test in the Next example.

## Vary Next's responses by the headers the strategy reads

With the `cookie` or `preferredLanguage` strategy, grai/next's proxy answers one URL in several locales, and a page Next renders ahead of time is sent as cacheable. A shared cache keyed by the URL alone then serves the first reader's locale to everyone. The proxy could add `Vary: Cookie` or `Accept-Language`, but Next writes its own `Vary` for its RSC requests, and whether it keeps the proxy's is not measured.

Done when: a page served through a shared cache renders in each reader's locale under those strategies, with a test.

## Ship one locale's client messages on Next.js

A client component's messages ship with every locale's variants: one Next build serves every locale, and Next gives an adapter no way to point a page at one locale's chunks. On the bench's page, grai costs 6.6 KB brotli more than the same page with its words written in, for 100 client messages in three locales and the runtime (`docs/runtime.md`).

Done when: a Next page's client chunks hold only its locale's variants, with a browser test that it loads no other locale's words.

## Make Next's first compile of a page cheaper

On the bench's page, `next dev`'s first response for the route takes 280–890 ms more with grai than with next-intl from an empty `.next`, and 66 ms more with it kept (`docs/runtime.md`): Turbopack compiles the whole output's 1.8 MB of message functions in each layer that imports them, server, server render and client, where next-intl's catalog is JSON.

Done when: a profile of that compile names where the time goes, and either a change brings it level with next-intl's or the design records why it stays.

## Report markup elements the base locale does not have

`Markup` throws for an element the app does not draw, and the app draws the base locale's. A translation that adds an element then throws in that locale only.

Done when: the compile, or `grai check`, reports a markup element that a locale names and the base locale does not.

## Prove the design on both reference apps

On the client, a forced `{ locale }` other than the current one throws, and every key must be in every locale. Neither app is known to break either rule outside its tests.

Done when: a local branch of each reference app on grai passes its own checks and tests, and the README cites the measured cold `dev`, one-message edit and `sync` times.

## A missing key's import in dev

`docs/design.md` says a per-key path to a key that does not exist resolves, in dev, to a module whose export throws a `GraiError` naming the key, with the key in the overlay. The Vite plugin does not yet: such an import fails when the page links its modules.

Done when: the Vite plugin serves that module and reports the key, with a test that a page importing a missing key loads and throws the `GraiError` only when the message is called.

## Import what `grai import` leaves out

It leaves out ICU's currency and skeleton styles and i18next's formats with options or other than `number` and `datetime`, which need their options mapped one by one, and ordinals (`selectordinal`, i18next's `_ordinal_`), which need an ordinal plural selector. vue-i18n's own syntax, with `|` plurals and `@:` links, is not ICU, and nothing reads it.

Done when: each converts, `bench/import-equivalence.mjs` covers it, and the design lists it.
