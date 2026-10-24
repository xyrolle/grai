# Follow-ups

Open work that `docs/design.md` leaves to measurement or to a later change.

## Ship one locale per page through an import map

The compiler gives each key a locale-free module and a per-locale variant, and one locale per page cuts app A's message bytes per page by 52–55% (`docs/runtime.md`). The default delivery keeps SvelteKit's single client build: the message chunks get a copy per locale under the same names, and the server writes an import map to the page's locale. Browsers apply no import map to modulepreload, so the server must also write the preload links for the locale's copies, or a page downloads both.

Done when: the Vite and SvelteKit adapters emit the copies, the import map and the preload links, with a browser test that a page loads no other locale's words and no shared message chunk.

## Decide how the client switches locale

A production page holds only its locale's words, and `setLocale(locale, { reload: false })` must behave the same in every build. The two options are in `docs/design.md`: load the target locale and then switch, or never switch within the page. Switching in place costs the target locale's chunks and one mount of the page, 2.3 ms for 2,000 messages (10.2 ms at a 4× CPU slowdown); a reload costs a server render, the page's data and a hydration.

Done when: the design records one option as a decision, and a browser test shows that a production build and dev switch the same way.

## Bind the locale, and index the variant directly

A message call renders in `options.locale ?? baseLocale`, and finds its variant with `locales.indexOf` on every call. The runtime lane's measured design binds the locale once (per request on the server, per page in the browser) and keeps its index.

Done when: the runtime binds the locale through the adapters, a call indexes its variant without a search, and a test renders two interleaved requests in different locales.

## Plural rules compiled from CLDR

`plural` uses one `Intl.PluralRules` per locale, 124–249 ns a call. CLDR's rules compiled into a function with an integer path first take 4–11 ns, for 158 more bytes per locale (`docs/runtime.md`).

Done when: `plural` uses each configured locale's rule compiled from CLDR's plural rules, kept in the repository rather than installed, with a test that it agrees with `Intl.PluralRules` on 0–10,000 and on fractions.

## Patch an edited message in place in dev

Re-evaluating the one dev module after an edit takes 202 ms on app A and 459 ms on app B. Sending the changed keys' functions as a patch, from grai's own `fs.watch` on the catalogs, takes 17–30 ms from the save to the page.

Done when: the Vite plugin patches in place and a browser test edits a catalog and sees the page change without a reload.

## Offer inlining text into templates, as an opt-in setting

The default is per-locale modules. Inlining text into templates before the framework compiles them halves hydration again (5.5 to 2.1 ms for 2,000 messages on app A) and cuts a server render from 0.08 to 0.02 ms (`docs/runtime.md`). It comes after the compiler and the Vite and SvelteKit adapters, and an app turns it on only if its costs measure acceptable. On app A, 43% of message uses would become static text; the rest keep the per-locale call.

Done when, measured on app A:
- the build shape is chosen by build time against today's single build: a build per locale, or one Rolldown pass that emits each component once per locale;
- the server's cost is known: one module graph per locale in the Worker, its upload size and its cold start;
- switching locale navigates to the other locale's build, and the client-switch decision above accounts for it;
- dev keeps one module and the patch, and a test shows no behaviour differs between dev and the inlined build but speed;
- text the framework would alter stays exact: Svelte trims the spaces at the edges of an element's text.

## Support MessageFormat 2's formatting functions

`:number`, `:integer`, `:datetime`, `:date` and `:time` are compile errors today, and so are function options (such as `select=ordinal`) and markup options and attributes. Neither reference app uses them, but they are common in MessageFormat 2 catalogs, so other adopters will meet these errors first.

Done when: each compiles to its `Intl` formatter, created once per locale and options, with a test per function and its options, and the design lists it among the constructs.

## Bind the locale in Next.js server components

Next renders server components outside the middleware's call, so an `AsyncLocalStorage` binding set there does not reach them.

Done when: the Next adapter binds the locale per request (React's request scope or Next's own), and a test renders two interleaved requests in different locales.

## Prove the design on both reference apps

On the client, a forced `{ locale }` other than the current one throws, and every key must be in every locale. Neither app is known to break either rule outside its tests.

Done when: a local branch of each reference app on grai passes its own checks and tests, and the README cites the measured cold `dev`, one-message edit and `sync` times.
