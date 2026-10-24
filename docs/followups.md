# Follow-ups

Open work that `docs/design.md` leaves to measurement or to a later change.

## Ship one locale per page through an import map

The Vite plugin writes each message chunk once per locale under `grai-<locale>/` (`docs/design.md`). The SvelteKit adapter still has to write the import map to the page's locale and point Kit's `modulepreload` links at the copies.

Done when: `grai/sveltekit` does both, with a browser test that a page of the example loads no other locale's words and no shared message chunk.

## Decide how the client switches locale

A production page holds only its locale's words, and `setLocale(locale, { reload: false })` must behave the same in every build. The two options are in `docs/design.md`: load the target locale and then switch, or never switch within the page. Switching in place costs the target locale's chunks and one mount of the page, 2.3 ms for 2,000 messages (10.2 ms at a 4× CPU slowdown); a reload costs a server render, the page's data and a hydration.

Done when: the design records one option as a decision, and a browser test shows that a production build and dev switch the same way.

## Support MessageFormat 2's formatting functions

`:number`, `:integer`, `:datetime`, `:date` and `:time` are compile errors today, and so are function options (such as `select=ordinal`) and markup options and attributes. Neither reference app uses them, but they are common in MessageFormat 2 catalogs, so other adopters will meet these errors first.

Done when: each compiles to its `Intl` formatter, created once per locale and options, with a test per function and its options, and the design lists it among the constructs.

## Bind the locale in Next.js server components

Next renders server components outside the middleware's call, so an `AsyncLocalStorage` binding set there does not reach them.

Done when: the Next adapter binds the locale per request (React's request scope or Next's own), and a test renders two interleaved requests in different locales.

## Prove the design on both reference apps

On the client, a forced `{ locale }` other than the current one throws, and every key must be in every locale. Neither app is known to break either rule outside its tests.

Done when: a local branch of each reference app on grai passes its own checks and tests, and the README cites the measured cold `dev`, one-message edit and `sync` times.

## A missing key's import in dev

`docs/design.md` says a per-key path to a key that does not exist resolves, in dev, to a module whose export throws a `GraiError` naming the key, with the key in the overlay. The Vite plugin does not yet: such an import fails when the page links its modules.

Done when: the Vite plugin serves that module and reports the key, with a test that a page importing a missing key loads and throws the `GraiError` only when the message is called.

## Rename what a module reads off a dynamic import

`grai rename` refuses `(await import("…/messages/key.js")).key` and `module.key` after `const module = await import(…)`, since the scan does not follow a value. Both are rare outside tests.

Done when: a rename changes them, with a test of each.
