# Runtime

How a message call, a page and a dev edit are made fast, decided by measurement. The baseline is Paraglide 2.29.1, compiled from the same catalogs. The catalogs are app A (SvelteKit on Cloudflare Workers, 6,366 keys × 3 locales when measured), app B (SvelteKit, 13,326 keys × 3) and `bench/synthetic.mjs`, which has app A's shape so that anyone can run every bench. The numbers are medians on an M-series Mac, with Node 24.16 and Chromium 156.

Each section names its bench: `pnpm <name>` in `bench/`, after `pnpm install` and `pnpm browsers` there. `GRAI_BENCH_A` and `GRAI_BENCH_B` point the benches at an app's checkout, and `GRAI_BENCH_A_STRATEGY` (or `_B_`) gives its strategy.

## Decisions

| | grai | because |
|---|---|---|
| Browser | One locale per bundle. A page's message chunks hold only that locale's functions. | Message bytes per page fall by 52–55% (brotli, `bytes`), and hydrating a page of 2,000 messages takes 14–32% less time (`hydrate`). |
| Locale in the browser | Fixed by the bundle the page loads. A call looks nothing up. | A call costs what a plain function call costs, 0.5 ns (`server`). |
| Locale on the server | Resolved once per request into `AsyncLocalStorage`. A call reads it once, through one shared dispatcher, and indexes the key's per-locale table. | The read is the floor while concurrent requests share the module: 13–23 ns a call in Node (`server`), 21 ns a read in workerd (`workerd`). A module variable bound per request costs 0.3 ns, but 50 of 200 interleaved renders then get another request's locale (`interleave`). |
| Server build | Each message function is a function expression. The browser's modules and `keys.js` keep arrows. | V8 parses an arrow function in full as it loads a module, and only pre-parses a function expression until its first call. App A's messages load in 24–25 ms against 30 ms with arrows, and in 26–28 ms against 30–33 ms in workerd, with the first render unchanged, for 0.7% more brotli bytes in the server bundle (`startup`). With Node's compile cache warm (`module.enableCompileCache()`), V8 reads the compiled code from disk and both load in 13–14 ms. |
| Plurals | CLDR's rules compiled into a function per locale, integers first. | 4–11 ns a call, against 124–249 ns for a cached `Intl.PluralRules`, for 158 more bytes min+gzip per locale (`plurals`). |
| Formatters | One `Intl` formatter per locale and options, made the first time it formats, and per value of an option an input gives. | 207–213 ns a number, against 695–770 ns for a cache keyed by the options and 8–9 µs for a formatter per call (`intl`). With its currency from an input, 216–305 ns, and Paraglide's 688–1,054 ns (`option-inputs`). |
| Per-locale chunks in SvelteKit | Same chunk names in a directory per locale, an import map, and modulepreload links the server writes for the locale's copies. | Browsers apply no import map to modulepreload, so Kit's own links also download the shared chunks: 51% more message bytes than no split at all (`preload`). |
| Dev | One module. An edit sends only the changed keys' functions, as a patch, from grai's own watcher on the catalogs. | 17–30 ms from the save to the page, against 202–459 ms re-evaluating the module (`hmr`). |
| Runtime | Constants, `getLocale`, `setLocale` and the URL helpers. | The apps' surface fits in 378 bytes min+gzip; Paraglide's is 1.9–2.1 KB (`runtime-size`). |

**Opt-in, later: inlining text into templates before the framework compiles them.** Svelte then sees static text. On the 2,000-message page, hydration takes 2.1–2.3 ms against 5.5–5.8 ms with per-locale modules, and the bundle 19.1 KB against 22.3 KB (`hydrate`); a server render takes 0.02–0.04 ms against 0.07–0.13 ms (`ssr`). On app A's largest page the messages take 17.2 KB against 24.5 KB (`bytes`). But every component then has code per locale, so the server needs every locale's components and the client a build per locale, and those costs are not measured yet (`docs/followups.md`). On app A, 43% of the 10,185 message uses in `src/` are the whole of a text, attribute or prop expression and would become static; 13% sit inside a larger expression; 44% are in script or used as values, and keep the per-locale call (`call-sites`).

Not adopted:
- **A strategy lookup per call.** The locale is resolved once per request on the server, and fixed by the bundle in the browser.
- **A dispatcher generated per key.** It is slower than one shared dispatcher, 25–52 ns against 13–23 ns a call (`server`): the engine keeps one hot function fast, and thousands of small copies slow.
- **Anything more for "only the keys a page uses".** Per-key modules already do it: on app A, the keys a page loads match the keys its code names, to within two (`bytes`).

## Compared with other libraries

grai against Paraglide 2.29.1, i18next 26.4 and use-intl 4.14 (intl-messageformat 11, as next-intl runs it), on app A's catalogs. Every library renders the same calls, from i18next JSON and ICU MessageFormat converted from the same catalogs (`bench/libraries.mjs`), and its text is checked against grai's before it is timed. One key of app B that neither format can hold is left out of every sample.

| | grai | Paraglide | i18next | use-intl |
|---|---|---|---|---|
| A text message on the server (`server`) | 16 ns | 17–33 ns | 1,170–1,859 ns | 2,396–3,058 ns |
| A plural message on the server (`server`) | 111–171 ns | 552–646 ns | 3,501–4,102 ns | 3,680–4,079 ns |
| Server render of a page of 2,000 messages (`ssr`) | 0.15–0.16 ms | 0.18–0.21 ms | 4.16–4.17 ms | 5.70–6.18 ms |
| Hydrating that page, at full CPU speed and at 4× slower (`hydrate`) | 7.6 / 34.7 ms | 10.7 / 50.0 ms | 16.1 / 75.6 ms | 22.3 / 104.5 ms |
| That page's JS, brotli (`hydrate`) | 22.7 KB | 38.6 KB | 125.2 KB | 122.6 KB |
| A new server process: loading every locale's messages, then the first render (`startup`) | 25 + 4 ms | 54 + 2 ms | 16 + 11 ms | 16 + 25 ms |
| Heap the messages hold (`startup`) | 5.2 MB | 8.3 MB | 3.4 MB | 10.3 MB |
| The runtime in the browser, brotli (`library-bytes`) | 0.5 KB | 3.6 KB | 12.1 KB | 10.2 KB |
| The messages a page downloads (`bytes`) | its own keys, in its locale: 24.5 KB on the largest page | its own keys, in every locale: 51.5 KB | the whole catalog: 104.4 KB | the whole catalog: 103.4 KB |
| A full compile (`compile-time`) | 67 ms | 3.8 s; 32.1 s with the declarations app A's `sync` writes | none, the catalog is read at run time | none; precompiling is optional, 79 ms a locale |
| One message edited, until the page shows it in Vite (`hmr`) | 12 ms | 3.8 s, its Vite plugin compiles again | 88 ms, the locale's JSON sent and parsed again | 94 ms, the same |
| Type checking 500 calls with `tsc` 7 (`types`) | 82 ms | 278 ms | 609 ms | 521 ms |
| The editor's first completion of a key, TypeScript 6 (`types`) | 0.2 s | 1.0 s | 49 s | 21 s |

The server rows run the prototype of grai's shared dispatcher in `bench/prototype.mjs`, with the locale from `AsyncLocalStorage`; timing grai's own output is open (`docs/followups.md`). In the browser a grai bundle holds one locale and a call looks nothing up. The startup rows bundle each library into one file, as a server build does; grai's is its Vite plugin's server build, measured at a load of 13–19 on 18 cores. i18next and use-intl load faster than grai and render slower: their catalogs are 1.6 MB of strings, which V8 reads faster than grai's 1.8 MB of functions, and they work out each message on its first call. Through the first render grai and i18next are level, 27–29 ms, and use-intl takes 41 ms (`startup`). On app B, twice app A's size, the gaps widen: i18next's first completion takes 258 s against grai's 0.3 s and Paraglide's 3.4 s (`types`), and the page's JS is 208 KB against 21 KB (`hydrate`). Each bench prints app B and the synthetic catalog too.

## Server

A message call inside a request, through 2,000 static call sites, 20 to a function (`server`). App A, in `ro` and `ru`:

| | text | with inputs | plural | 2,000 calls |
|---|---|---|---|---|
| Paraglide | 25–28 ns | 64–95 ns | 533–644 ns | 102–105 µs |
| grai, shared dispatcher, locale from ALS | 14–23 ns | 70–74 ns | 99–163 ns | 49–53 µs |
| grai, per-locale module | 0.5 ns | 14–15 ns | 71–97 ns | 11–12 µs |

App B gives the same picture. The plural column uses compiled rules without the integer path.

- `AsyncLocalStorage` costs 21 ns a read in workerd, and a module variable 0.3 ns (`workerd`).
- A module variable bound per request is not safe: of 200 renders that await between two messages, 50 render another request's locale, and none through `AsyncLocalStorage` (`interleave`).
- In a Svelte server render of a page of 2,000 messages (`ssr`), messages are 76–80% of 0.10–0.17 ms.

What each library's middleware adds to a request, resolving its locale by the same strategy from the same catalogs, and binding it (`middleware`). The range is three runs:

| request | grai, Node | Paraglide, Node | grai, workerd | Paraglide, workerd |
|---|---|---|---|---|
| a locale cookie | 0.70–0.91 µs | 4.0–5.5 µs | 2.0–2.5 µs | 6.2–7.7 µs |
| `Accept-Language`, no locale cookie | 1.2–1.5 µs | 5.4–7.0 µs | 3.9–4.6 µs | 8.6–10.4 µs |
| a URL prefix | 0.62–0.85 µs | 6.6–8.9 µs | 1.4–1.9 µs | 7.2–8.4 µs |

A handler alone takes 1.1–1.6 µs in Node and 0.6–1.0 µs in workerd. grai's figures include listing the headers it read in `Vary`. Paraglide's copy the request for the handler, and decide whether to redirect. Reading `Accept-Language` costs grai 0.5 µs more than the cookie in Node, and 2.5 µs more in workerd, where the same code runs about 2.5 times slower: a message call inside a request takes 8.7–10.5 ns in Node and 24–28 ns in workerd.

## Browser

A server-rendered Svelte page of 2,000 message calls, hydrated, then mounted again, the client's part of a locale switch without a reload (`hydrate`). App A, `ro`, at full CPU speed and at a 4× slowdown:

| | JS, brotli | hydrate | hydrated at | mount again |
|---|---|---|---|---|
| Paraglide | 37.9 KB | 7.6 / 33.4 ms | 20.3 / 80.3 ms | 2.9 / 12.7 ms |
| grai, per-locale module | 22.3 KB | 5.5 / 24.4 ms | 14.5 / 56.9 ms | 2.3 / 10.2 ms |
| inlined into the template | 19.1 KB | 2.1 / 10.1 ms | 10.1 / 37.5 ms | 1.0 / 4.9 ms |

On app B, whose URL strategy makes Paraglide's per-call lookup cheaper, the per-locale module hydrates 14–18% faster instead of 27–32%.

In a Svelte client build, `grai/svelte` reads each message without inputs as its string (`svelte-texts`). The same page and catalog, built by Vite through grai's own plugins and loaded through its locale's import map, `ro`, at full CPU speed and at a 4× slowdown:

| text messages as | JS, brotli | hydrate | mount again |
|---|---|---|---|
| calls (`grai/vite`) | 24.6 KB | 5.8 / 24.6 ms | 2.7 / 11.4 ms |
| strings (`grai/svelte`) | 23.9 KB | 3.6 / 16.6 ms | 2.2 / 8.8 ms |
| inlined into the template | 21.0 KB | 2.8 / 12.7 ms | 1.9 / 8.0 ms |

`ru` gives 25.1, 16.7 and 13.3 ms at 4×.

## Bytes per page

Every page of app A's production build, its keys bundled and minified by Rolldown per scheme (`record-build` in a copy of the app, then `bytes`). Brotli KB:

| page | keys | page JS | every locale | Paraglide's per-locale build | grai, one locale | no-input messages exported as strings | no-input messages inlined |
|---|---|---|---|---|---|---|---|
| largest | 991 | 531 | 51.5 | 30.0 | 24.5 | 24.4 | 17.2 |
| 10th | 672 | 445 | 43.1 | 23.7 | 19.7 | 19.6 | 15.0 |
| all 73, summed | | 21,055 | 2,005 | 1,102 | 916 | 913 | 692 |

Exporting a message without inputs as its string instead of a function saves almost nothing. Its bytes go only when the text moves into the calling component's code, which is the opt-in inlining.

App B already copies its message chunks per locale after the build and points each document at its locale's copies with an import map (`variants`). The copies are 49% smaller than the shared chunks, but Kit's modulepreload links name the shared ones, and Chromium and WebKit then fetch both (`preload`): 3,509 KB over its 89 pages, against 2,326 KB without the split.

## Plurals and formatters

Every variant agrees with `Intl.PluralRules` on 0–10,000 and on fractions before it is timed on 0–999 (`plurals`):

| | ro | ru | en | bytes, min+gzip |
|---|---|---|---|---|
| Paraglide | 537 ns | 458 ns | 428 ns | |
| `Intl.PluralRules`, cached | 249 ns | 162 ns | 124 ns | 97 |
| CLDR rules compiled | 56 ns | 63 ns | 40 ns | 184 |
| compiled, integer path first | 6.8 ns | 11.4 ns | 3.9 ns | 255 |

Ordinals are compiled the same way, from CLDR's ordinal rules, and checked against `Intl.PluralRules` of type ordinal alike (`ordinals`, four runs at a load of 10–21). A language that ranks every count alike, as `ru` does, gets a function that returns `other`, so a bundle of it is 63 bytes, not 320:

| | ro | ru | en | bytes, min+gzip (ro, ru, en) |
|---|---|---|---|---|
| Paraglide, `type=ordinal` | 489–661 ns | 451–503 ns | 613–708 ns | 593 |
| `Intl.PluralRules`, cached | 143–155 ns | 100–115 ns | 261–297 ns | 103 |
| grai | 3.3–3.6 ns | 3.0–3.5 ns | 9.8–11.1 ns | 330, 63, 375 |

A formatter per locale and options formats a number in 207–213 ns and a date in 462–526 ns. Paraglide's cache takes 695–770 ns and 947–1,038 ns, and a new formatter per call 8.3–9.3 µs and 21.7–23.9 µs (`intl`).

## Dev

One message edited in a catalog until the page shows it, through Vite's dev server and Chromium (`hmr`):

| | dev module | edit to page | of which the file watcher |
|---|---|---|---|
| app A, whole module re-evaluated | 1.9 MB | 202 ms | 48 ms |
| app A, patch, Vite's watcher | 1.9 MB | 123 ms | 114 ms |
| app A, patch, grai's `fs.watch` | 1.9 MB | 16.6 ms | 4.3 ms |
| app B, whole module re-evaluated | 4.3 MB | 459 ms | 78 ms |
| app B, patch, grai's `fs.watch` | 4.3 MB | 30.1 ms | 9.8 ms |

Vite's watcher alone takes 48–114 ms to report a save, and `fs.watch` 3–10 ms. With a patch, the browser's part is 2–3 ms whatever the module's size.

## Runtime size

The runtime the apps call (`getLocale`, `setLocale`, `locales`, `baseLocale`, `isLocale`, `localizeHref`, `deLocalizeUrl`), bundled for the browser (`runtime-size`): Paraglide's is 2,132 bytes min+gzip with a cookie strategy and 1,881 with a URL strategy, and a sketch with the locale fixed per bundle is 378.
