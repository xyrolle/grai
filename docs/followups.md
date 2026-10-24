# Follow-ups

Open work that `docs/design.md` leaves to measurement or to a later change.

## Ship one locale per page through an import map

The compiler gives each key a locale-free module and a per-locale variant, and one locale per page cuts app A's message bytes per page by 52–55% (`docs/runtime.md`). The default delivery keeps SvelteKit's single client build: the message chunks get a copy per locale under the same names, and the server writes an import map to the page's locale. Browsers apply no import map to modulepreload, so the server must also write the preload links for the locale's copies, or a page downloads both.

Done when: the Vite and SvelteKit adapters emit the copies, the import map and the preload links, with a browser test that a page loads no other locale's words and no shared message chunk.

## Decide how the client switches locale

A production page holds only its locale's words, and `setLocale(locale, { reload: false })` must behave the same in every build. The two options are in `docs/design.md`: load the target locale and then switch, or never switch within the page. Switching in place costs the target locale's chunks and one mount of the page, 2.3 ms for 2,000 messages (10.2 ms at a 4× CPU slowdown); a reload costs a server render, the page's data and a hydration.

Done when: the design records one option as a decision, and a browser test shows that a production build and dev switch the same way.

## Show a server text call at 20 ns or less

A text message called in a request reads the request's locale from `AsyncLocalStorage`. On a loaded machine that measured 24–27 ns, against 28–32 ns for the runtime lane's prototype run alongside, which measured 14–23 ns on a quiet one.

Done when: `bench/` runs grai's own output on a quiet machine and shows a text call in a request at 20 ns or less, or the design records why the floor is higher.

## Support MessageFormat 2's formatting functions

`:number`, `:integer`, `:datetime`, `:date` and `:time` are compile errors today, and so are function options (such as `select=ordinal`) and markup options and attributes. Neither reference app uses them, but they are common in MessageFormat 2 catalogs, so other adopters will meet these errors first.

Done when: each compiles to its `Intl` formatter, created once per locale and options, with a test per function and its options, and the design lists it among the constructs.

## Bind the locale in Next.js server components

Next renders server components outside the middleware's call, so an `AsyncLocalStorage` binding set there does not reach them.

Done when: the Next adapter binds the locale per request (React's request scope or Next's own), and a test renders two interleaved requests in different locales.

## Prove the design on both reference apps

On the client, a forced `{ locale }` other than the current one throws, and every key must be in every locale. Neither app is known to break either rule outside its tests.

Done when: a local branch of each reference app on grai passes its own checks and tests, and the README cites the measured cold `dev`, one-message edit and `sync` times.
