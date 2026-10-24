# Follow-ups

Open work that `docs/design.md` leaves to measurement or to a later change.

## Choose how the browser gets only its locale

The compiler gives each key a locale-free module and a per-locale variant. How the variants are delivered is still open: an import map over per-locale chunk directories, a build per locale, or strings inlined per locale.

Done when: `bench/` measures the bytes per route and the build time of each on app A's catalog, and the Vite adapter ships the winner with a browser test that a page loads no other locale's words.

## Decide how the client switches locale

A production page holds only its locale's words, and `setLocale(locale, { reload: false })` must behave the same in every build. The two options are in `docs/design.md`: load the target locale and then switch, or never switch within the page.

Done when: `bench/` measures the load-then-switch option on app A, the design records one option as a decision, and a browser test shows that a production build and dev switch the same way.

## Measure plural rules and the bound locale

`plural` uses one `Intl.PluralRules` per locale, and a message call on the server reads the request's locale from `AsyncLocalStorage`. Neither is measured yet against its alternative: compiled CLDR rules, and a strategy lookup per call.

Done when: `bench/` has both comparisons on an SSR page that renders thousands of messages, and the runtime keeps whichever is faster for its bytes.

## Support MessageFormat 2's formatting functions

`:number`, `:integer`, `:datetime`, `:date` and `:time` are compile errors today, and so are function options (such as `select=ordinal`) and markup options and attributes. Neither reference app uses them, but they are common in MessageFormat 2 catalogs, so other adopters will meet these errors first.

Done when: each compiles to its `Intl` formatter, created once per locale and options, with a test per function and its options, and the design lists it among the constructs.

## Bind the locale in Next.js server components

Next renders server components outside the middleware's call, so an `AsyncLocalStorage` binding set there does not reach them.

Done when: the Next adapter binds the locale per request (React's request scope or Next's own), and a test renders two interleaved requests in different locales.

## Prove the design on both reference apps

On the client, a forced `{ locale }` other than the current one throws, and every key must be in every locale. Neither app is known to break either rule outside its tests.

Done when: a local branch of each reference app on grai passes its own checks and tests, and the README cites the measured cold `dev`, one-message edit and `sync` times.
