# Runtime

How a message call, a page and a dev edit are made fast, decided by measurement. The baseline is Paraglide 2.29.1, compiled from the same catalogs. The catalogs are app A (SvelteKit on Cloudflare Workers, 6,366 keys × 3 locales when measured), app B (SvelteKit, 13,326 keys × 3) and `bench/synthetic.mjs`, which has app A's shape so that anyone can run every bench. The numbers are medians on an M-series Mac, with Node 24.16 and Chromium 156.

Each section names its bench: `pnpm <name>` in `bench/`, after `pnpm install` and `pnpm browsers` there. `GRAI_BENCH_A` and `GRAI_BENCH_B` point the benches at an app's checkout, and `GRAI_BENCH_A_STRATEGY` (or `_B_`) gives its strategy.

## Decisions

| | grai | because |
|---|---|---|
| Browser | One locale per bundle. A page's message chunks hold only that locale's functions. | As built, app A's whole catalog in Russian is 99.4 KB brotli in its locale's copies of the message chunks, against 276.9 KB for Paraglide's messages of every locale (`library-bytes`). Per page, over app A's 73 pages, the locale's copies take 38% fewer message bytes than Paraglide's of every locale, and 13% more than its per-locale build (`bytes`). Hydrating a page of 2,000 messages takes 20–34% less time than Paraglide's (`hydrate`). |
| Locale in the browser | Fixed by the bundle the page loads. A call reads the page's locale once, from `<html lang>`, and runs no strategy. | A text message costs 4.4–4.8 ns a call in Chromium, against 361–394 ns for Paraglide's, which runs its strategy on every call (`client`). |
| Locale on the server | Resolved once per request into `AsyncLocalStorage`. A call reads it once and takes the locale's function: through one shared dispatcher, or in a server build's message with inputs, in a switch of its own. | The read is the floor while concurrent requests share the module: a text message costs 19–25 ns a call in Node, about one read, as Paraglide's `getLocale()` alone takes 17–30 ns in the same runs (`server`), and a read costs 21 ns in workerd (`workerd`). A module variable bound per request costs 0.3 ns, but 50 of 200 interleaved renders then get another request's locale (`interleave`). |
| Server build | Each message function is a function expression. The browser's modules and `keys.js` keep arrows. | V8 parses an arrow function in full as it loads a module, and only pre-parses a function expression until its first call. App A's messages load in 24–25 ms against 30 ms with arrows, and in 26–28 ms against 30–33 ms in workerd, with the first render unchanged, for 0.7% more brotli bytes in the server bundle (`startup`). With Node's compile cache warm (`module.enableCompileCache()`), V8 reads the compiled code from disk and both load in 13–14 ms. |
| Server messages with inputs | A function of each key's own that switches on the call's locale, each locale's code in its case. Texts and markup keep the shared dispatcher. | A call with inputs takes 23–71 ns against 67–92 ns through the shared dispatcher, whose call of the locale's function goes megamorphic, and the server loads 0.1–2.1 ms faster; its first render is 0.8–1.8 ms slower (`docs/design.md`). |
| Server chunks | The keys that two or more entries use in one chunk. A key one entry uses stays in that entry's chunk. | A server loads each chunk as a module. Split by the entries that use them, 64 pages that use app A's keys, six in ten keys on one page and the rest on 2 to 16, take 2,668 modules, against 65. Loading every page takes 38 ms against 568–590 ms in Node, and 42–43 ms against 99–106 ms in workerd. One page takes 8.0–8.1 ms against 29–31 ms in Node, and 9 ms against 6 ms in workerd, which loads small modules cheaply. App B gives the same picture, 75 ms against 1,161–1,163 ms for every page in Node (`server-pages`). |
| Plurals | CLDR's rules compiled into a function per locale, integers first. | 3.4–11.4 ns a call as plurals.js has them, against 112–246 ns for a cached `Intl.PluralRules`, for 332 more bytes min+gzip in Russian (`plurals`). |
| Formatters | One `Intl` formatter per locale and options, made the first time it formats, and per value of an option an input gives. | A compiled message that formats a number takes 201–220 ns a call on the server, its formatter alone 198–207 ns, against 659–664 ns for a cache keyed by the options and 7.9–8.1 µs for a formatter per call; a date, 430–480 ns (`intl`). With its currency from an input, 216–305 ns, and Paraglide's 688–1,054 ns (`option-inputs`). |
| Per-locale chunks in SvelteKit | Same chunk names in a directory per locale, an import map, and modulepreload links the server writes for the locale's copies. | Browsers apply no import map to modulepreload, so Kit's own links also download the shared chunks: 51% more message bytes than no split at all (`preload`). |
| A page no server draws | An inline script ahead of every module picks the locale from the strategy's places and, with `localeChunks`, writes the import map to its copies and preloads them. | Until the page's entry module runs, it costs 0.2 ms at full CPU speed and 3.7 ms at 4× slower, against the same import map written into the page (`page-locale`). It is 910 bytes brotli; of its run, the import map and preloads take 0.3–1.4 ms, and a cookie read 0.2–0.8 ms. |
| Dev | One module. An edit sends only the changed keys' functions, as a patch, from grai's own watcher on the catalogs. | 10–15 ms from the save to the page with grai's plugin, and 8.7–11.5 ms to a server render, against 225–251 ms re-sending and re-evaluating the module (`hmr`). |
| Runtime | Constants, `getLocale`, `setLocale` and the URL helpers. | The apps' surface, as grai compiles it, is 633 bytes min+gzip with a cookie strategy and 755 with a URL strategy; Paraglide's is 1.9–2.1 KB (`runtime-size`). |

**Not adopted: inlining text into templates before the framework compiles them.** Svelte then sees static text. On the 2,000-message page, hydration takes 2.3–2.6 ms against 5.4–5.6 ms with the locale's copies, and the bundle 19.1–20.4 KB against 22.9–23.8 KB (`hydrate`); a server render takes 0.04 ms against 0.13 ms (`ssr`). On app A's real pages, where messages are a small part of what hydration does, it hydrates within the noise of `grai/svelte`'s strings, for a copy per locale of every component chunk with such a text (Browser, below). On app A, 43% of the 10,185 message uses in `src/` are the whole of a text, attribute or prop expression and would become static; 13% sit inside a larger expression; 44% are in script or used as values, and keep the per-locale call (`call-sites`).

Not adopted:
- **Strings put in place of the calls after the framework compiled them.** Svelte has compiled each call as a dynamic expression, so the page hydrates as it does with the calls: 23.9–24.1 ms against 23.3–24.3 ms at a 4× slowdown, where `grai/svelte`'s strings take 15.9–16.2 ms (`svelte-texts`). It would also cost the build: SvelteKit has one client build, so a build per locale, 2 more client builds of 8.1 s on app A, cannot serve its pages, and copies per locale of the 326 of its 1,598 client chunks that call a message are 978 more files behind the import map (`inline-cost`).
- **A strategy lookup per call.** The locale is resolved once per request on the server, and fixed by the bundle in the browser.
- **A dispatcher generated per key for a text message.** Each copy reads the request's locale itself, and it is slower than one shared dispatcher: 49–103 ns against 19–25 ns a call (`server`). The engine keeps one hot function fast, and thousands of small copies slow. For a message with inputs, a dispatch of each key's own halves the call: a server build has one, and a page does not, where it costs the load more than the calls save (`docs/design.md`).
- **One object `m` of every key on a server, in place of a binding per key.** It loads faster: app A's keys and a page of calls load in 13.7 ms against 18.9, and app B's in 21.7 against 34.3 ms. But each call then reads `m` as a dictionary of thousands of properties: 24.7 ns a call against 18.0 on app A and 22.1 against 16.6 on app B, once optimized. With Node's compile cache warm it loads no faster, 9.9 ms against 9.3 on app A (`server-shapes`). A server pays the load once, and the call on every render.
- **The text keys' strings from one JSON string, beside a binding per key.** It loads slower, 19.4 ms against 18.9 on app A and 35.6 against 34.3 on app B (`server-shapes`): reading each key's strings off the parsed object costs more than parsing them as JSON saves. JSON pays only in the object above.
- **Anything more for "only the keys a page uses".** Per-key modules give each set of entries exactly its keys, and the build pools the small sets on purpose (`docs/design.md`): on app A a page loads 56% more keys than it uses, in 17 message chunks rather than 49 (median), and its JS is 1.5% smaller.
- **Every key of a server build in one chunk.** Every page then loads every key: one page of app A's took 22–23 ms against 9–10 ms in workerd, in an earlier run (`server-pages`). Merging the chunks of small sets of entries instead, under 2 to 32 KB, left 106 to 421 modules and 116–352 ms to load every page in Node.

## Compared with other libraries

grai against Paraglide 2.29.1, i18next 26.4 and use-intl 4.14 (intl-messageformat 11, as next-intl runs it), on app A's catalogs. Every library renders the same calls, from i18next JSON and ICU MessageFormat converted from the same catalogs (`bench/libraries.mjs`), and its text is checked against grai's before it is timed. One key of app B that neither format can hold is left out of every sample.

| | grai | Paraglide | i18next | use-intl |
|---|---|---|---|---|
| A text message on the server (`server`) | 19–25 ns | 46–50 ns | 1,434–1,815 ns | 2,746–3,211 ns |
| A message with inputs on the server (`server`) | 110–130 ns | 67–122 ns | 3,627–4,262 ns | 3,029–3,519 ns |
| A plural message on the server (`server`) | 79–90 ns | 667–787 ns | 3,869–4,094 ns | 4,207–4,448 ns |
| A message with markup, its parts drawn, on the server (`server`) | 121–150 ns | 139–154 ns | no API outside react-i18next's `Trans` | 3,307–3,952 ns, `t.markup` |
| A text message in a page (`client`) | 4.4–4.8 ns | 361–394 ns; 4.5–5.9 ns given `{ locale }` | 1,031–1,100 ns | 1,337–1,494 ns |
| A message with inputs in a page (`client`) | 18–19 ns | 366–392 ns; 11.7–12.3 ns given `{ locale }` | 2,063–2,163 ns | 1,363–1,531 ns |
| Server render of a page of 2,000 messages (`ssr`) | 0.13 ms | 0.20–0.23 ms | 3.89–3.93 ms | 4.84–5.04 ms |
| Hydrating that page, at full CPU speed and at 4× slower (`hydrate`) | 5.4–6.9 / 22.3–27.8 ms | 7.9–10.4 / 33.5–43.0 ms | 12.2–15.6 / 52.9–66.9 ms | 16.7–21.6 / 71.2–89.2 ms |
| That page's JS, brotli (`hydrate`) | 22.9–24.9 KB | 38.0–40.5 KB | 125.1–133.3 KB | 124.6–132.5 KB |
| A new server process: loading every locale's messages, then the first render (`startup`) | 16.6 + 3.1 ms | 46.6 + 2.3 ms | 14.5 + 11.2 ms | 13.0 + 21.9 ms |
| The same, with Node's compile cache warm (`startup`) | 8.0 + 3.2 ms | 19.5 + 2.4 ms | 11.5 + 11.2 ms | 10.5 + 22.5 ms |
| Heap the messages hold (`startup`) | 4.1 MB | 7.1 MB | 3.2 MB | 9.9 MB |
| The runtime in the browser, its whole API, brotli (`library-bytes`) | 1.0 KB | 3.6 KB | 12.1 KB | 10.2 KB |
| The messages a page downloads (`bytes`) | its keys and some its chunks share, in its locale: 34.5 KB on the largest page with `localeChunks`, 71.3 KB in every locale without | its own keys, in every locale: 51.6 KB | the whole catalog: 104.4 KB | the whole catalog: 103.4 KB |
| A full compile (`compile-time`) | 67 ms | 3.8 s; 32.1 s with the declarations app A's `sync` writes | none, the catalog is read at run time | none; precompiling is optional, 79 ms a locale |
| One message edited, until the page shows it in Vite (`hmr`) | 12 ms | 3.8 s, its Vite plugin compiles again | 88 ms, the locale's JSON sent and parsed again | 94 ms, the same |
| A dev page's heap once collected, with the whole catalog, and what each edit adds (`hmr`) | 8.0 MB; 5.4 KB | 57.6 MB; 40.7 MB | 7.0 MB; 4.8 MB | 6.8 MB; 4.5 MB |
| Type checking 500 calls with `tsc` 7 (`types`) | 82 ms | 278 ms | 609 ms | 521 ms |
| The editor's first completion of a key, TypeScript 6 (`types`) | 0.2 s | 1.0 s | 49 s | 21 s |

The server rows run grai's output as its Vite plugin builds it for a server, inside a request that grai's middleware binds to the locale; the page rows run its client build in Chromium, with the page's locale copies swapped in as an import map swaps them. Paraglide's call in a page runs its strategy each time, which a call given `{ locale }` skips. These rows were measured on app A, at 6,379 and then 6,418 keys as its catalogs grew between the runs, at a load of 9–18 on 18 cores: the page rows in two runs and the server rows in one, each range covering its runs and both locales. The startup rows bundle each library into one file with a page of the sample's static calls, as a server build holds them; grai's is its Vite plugin's server build, measured at a load of about 5 on 18 cores. i18next and use-intl load faster than grai and render slower. V8 parses grai's binding for each key and its text keys' strings as code, and their catalogs as data; they then work out each message on its first call. Through the first render grai is ahead: 19.7 ms against 25.7 ms for i18next and 34.9 ms for use-intl. With Node's compile cache warm, grai also loads first (`startup`). On app B, twice app A's size, the gaps widen: i18next's first completion takes 258 s against grai's 0.3 s and Paraglide's 3.4 s (`types`), and the page's JS is 208 KB against 21 KB (`hydrate`). Each bench prints app B and the synthetic catalog too.

## Server

A message call inside a request, through 2,000 static call sites, 20 to a function (`server`). App A, in `ro` and `ru`:

| | text | with inputs | plural | markup | 2,000 calls |
|---|---|---|---|---|---|
| Paraglide | 46–50 ns | 67–122 ns | 667–787 ns | 139–154 ns | 110–178 µs |
| Paraglide, given `{ locale }` | 13–32 ns | 40–67 ns | 567–698 ns | 117–129 ns | 79–98 µs |
| grai | 19–25 ns | 110–130 ns | 79–90 ns | 121–150 ns | 62–98 µs |
| grai, given `{ locale }` | 11–12 ns | 71–115 ns | 81–106 ns | 110–148 ns | 40–61 µs |
| prototype, a dispatcher per key | 57–68 ns | 96–139 ns | 133–184 ns | | 131–138 µs |

App B gives the same picture. These rows were measured through the shared dispatcher, whose call of the locale's function goes megamorphic. A server build's message with inputs now switches on the locale in its own code: side by side with the shared dispatcher, a call with inputs takes 43–71 ns against 83–92 ns on app A and 65–68 ns against 87–92 ns on app B, where Paraglide's given `{ locale }` takes 40 and 45 ns (`docs/design.md`).

- `AsyncLocalStorage` costs 21 ns a read in workerd, and a module variable 0.3 ns (`workerd`).
- A module variable bound per request is not safe: of 200 renders that await between two messages, 50 render another request's locale, and none through `AsyncLocalStorage` (`interleave`).
- In a Svelte server render of a page of 2,000 messages (`ssr`), messages are 70% of 0.13 ms.

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
| Paraglide | 38.0–40.5 KB | 7.9–8.4 / 33.5–43.0 ms | 21.5–22.5 / 81.1–102.1 ms | 3.1–3.2 / 13.1–16.6 ms |
| grai, the locale's copies | 22.9–23.8 KB | 5.4–5.6 / 22.3–27.8 ms | 15.5–15.7 / 58.6–74.0 ms | 2.4–2.5 / 10.5–13.2 ms |
| grai, every locale's chunks, as a SvelteKit page loads them today | 35.7–38.2 KB | 5.4–5.7 / 22.6–26.3 ms | 17.3–17.7 / 63.2–81.5 ms | 2.4–2.5 / 10.2–12.4 ms |
| prototype, inlined into the template | 19.1–20.4 KB | 2.3–2.6 / 10.1–13.2 ms | 10.9–11.2 / 37.7–48.3 ms | 1.1–1.2 / 4.9–6.4 ms |

The copies are grai's own client build, its message chunks swapped for the locale's copies as the import map swaps them, and hydrate in the time the prototype's per-locale module did, 5.8–5.9 ms in the same window. On app B, whose URL strategy makes Paraglide's per-call lookup cheaper, the locale's copies hydrate 20–24% faster instead of 32–34%.

In a Svelte client build, `grai/svelte` reads each message without inputs as its string (`svelte-texts`). The same page and catalog, built by Vite through grai's own plugins and loaded through its locale's import map, `ro`, at full CPU speed and at a 4× slowdown:

| text messages as | JS, brotli | hydrate | mount again |
|---|---|---|---|
| calls (`grai/vite`) | 24.7 KB | 5.8 / 24.3 ms | 2.6 / 10.9 ms |
| strings (`grai/svelte`) | 23.9 KB | 3.8 / 16.2 ms | 2.0 / 8.2 ms |
| strings put in place of the calls after Svelte compiled | 22.7 KB | 5.8 / 23.9 ms | 2.5 / 10.9 ms |
| inlined into the template | 21.2 KB | 2.9 / 12.9 ms | 1.9 / 7.9 ms |

`ru` gives 23.3, 15.9, 24.1 and 12.5 ms at 4×.

A page that imports each key by its own path (`#i18n/messages/<key>.js`, mapped to keys.js) reads the same strings. On the synthetic catalog, in `ro`, it loads 23.4 KB and hydrates in 4.9 / 20.8 ms, against 23.3 KB and 4.9 / 20.5 ms through the namespace. Before `grai/svelte` followed a key's path to the key's own module, that page kept its calls: 24.3 KB and 5.6 / 23.1 ms (`svelte-texts synthetic`).

Seven of app A's real pages, built three ways (`inline-build` in copies of the app) and served side by side (`inline-pages`): the five heaviest its demo data fills, by the keys they load (ranks 1, 2, 3, 5 and 8 of 73), and two typical ones. On each, every build's page has the same text, whitespace included, as served and as hydrated, and hydration keeps the same server elements. Median of 15 interleaved loads, ms from SvelteKit's start until it has hydrated the page, at full speed and at a 4× slowdown, at a load of 15–22:

| keys | JS, brotli: strings / inlined | calls (`grai/vite`) | strings (`grai/svelte`) | inlined into the template |
|---|---|---|---|---|
| 1,315 | 522 / 509 KB | 485 / 635 | 457 / 658 | 429 / 600 |
| 1,094 | 478 / 466 KB | 384 / 527 | 400 / 520 | 409 / 523 |
| 1,046 | 435 / 428 KB | 376 / 494 | 334 / 460 | 331 / 449 |
| 991 | 432 / 419 KB | 360 / 459 | 335 / 492 | 313 / 459 |
| 977 | 405 / 399 KB | 313 / 442 | 310 / 444 | 294 / 461 |
| 689 | 298 / 293 KB | 274 / 371 | 257 / 359 | 253 / 368 |
| 601 | 442 / 431 KB | 410 / 551 | 385 / 547 | 400 / 517 |

Against the strings, inlining changes the 4× time by −9% to +4%, no more than the calls differ from the strings in the same run, either way, and the page's JS falls by 1–3%. Its build would need a copy per locale of 248 of the 1,080 client chunks, 744 more files, made in 0.4–0.6 s, or 2 more client builds of 15–22 s (`inline-build`).

## Bytes per page

Every page of app A's production build, built twice from one commit, on Paraglide 2.25.4 and on grai with `localeChunks`, as `grai/sveltekit/vite` builds it (`record-build` in a copy of each, then `bytes`). grai's columns are the files its build writes: its message chunks, which hold every locale, and the locale's copies of them, which a page loads through the import map. Paraglide's build mixes its messages into other chunks, so its columns bundle the page's keys alone, with Rolldown, into one file, which compresses better than chunks do. Brotli KB, in `ru`:

| page | keys, Paraglide / grai | page JS, Paraglide | page JS, grai, the locale's copies | Paraglide, every locale | Paraglide's per-locale build | grai's chunks, every locale | grai, the locale's copies |
|---|---|---|---|---|---|---|---|
| largest | 992 / 1,348 | 531.2 | 478.2 | 51.6 | 30.0 | 71.3 | 34.5 |
| 10th | 673 / 975 | 445.0 | 409.5 | 43.1 | 23.8 | 57.5 | 26.8 |
| all 73, summed | | 21,059 | 19,477 | 2,008 | 1,104 | 2,685 | 1,250 |

- **The locale's copies are 53% smaller than grai's chunks** and 38% smaller than Paraglide's messages in every locale, but 13% larger than Paraglide's per-locale build. grai's chunks hold keys a page's own code does not name, as chunks that sets of entries share (1,348 keys on the largest page, against the 992 its code names); and each chunk compresses alone (`docs/followups.md`).
- **A page's JS on grai is 8% smaller than on Paraglide** with the locale's copies, and 0.7% smaller with the chunks as written, which a build without `localeChunks` writes alone.
- **Inlining the text into the template is a prototype.** Its per-locale module of plain functions takes 918 KB summed, and 692 KB with each message without inputs inlined at its call sites. The 224 KB between them, 1.1% of the pages' JS, is what inlining moves into the components.

App B already copies its message chunks per locale after the build and points each document at its locale's copies with an import map (`variants`). The copies are 49% smaller than the shared chunks, but Kit's modulepreload links name the shared ones, and Chromium and WebKit then fetch both (`preload`): 3,509 KB over its 89 pages, against 2,326 KB without the split.

## Plurals and formatters

Every variant agrees with `Intl.PluralRules` on 0–10,000 and on fractions before it is timed on 0–999 (`plurals`):

| | ro | ru | en | bytes, min+gzip |
|---|---|---|---|---|
| Paraglide | 537 ns | 458 ns | 428 ns | |
| `Intl.PluralRules`, cached | 249 ns | 162 ns | 124 ns | 97 |
| **grai, the rules plurals.js has** | 6.8 ns | 11.4 ns | 3.4 ns | 429 |
| experiment: CLDR's rules compiled by make-plural | 56 ns | 63 ns | 40 ns | 184 |
| experiment: the same with an integer path first, as the design began | 6.8 ns | 11.4 ns | 3.9 ns | 255 |

grai's rules take the integer path first too, and for any other count read its operands as `Intl.PluralRules` rounds them, to three fraction digits, which the experiment's integer path left out: most of the 429 bytes.

Ordinals are compiled the same way, from CLDR's ordinal rules, and checked against `Intl.PluralRules` of type ordinal alike (`ordinals`, four runs at a load of 10–21). A language that ranks every count alike, as `ru` does, gets a function that returns `other`, so a bundle of it is 63 bytes, not 320:

| | ro | ru | en | bytes, min+gzip (ro, ru, en) |
|---|---|---|---|---|
| Paraglide, `type=ordinal` | 489–661 ns | 451–503 ns | 613–708 ns | 593 |
| `Intl.PluralRules`, cached | 143–155 ns | 100–115 ns | 261–297 ns | 103 |
| grai | 3.3–3.6 ns | 3.0–3.5 ns | 9.8–11.1 ns | 330, 63, 375 |

grai's compiled message, called on the server with a locale, formats a number in 201–220 ns and a date in 430–480 ns, as its formatter alone, made once per locale and options, does: 198–207 ns and 453–502 ns. Paraglide's cache takes 659–664 ns and 977–1,015 ns, and a new formatter per call 7.9–8.1 µs and 18.0–18.3 µs (`intl`).

## Dev

One message edited in a catalog until the page shows it, through Vite's dev server and Chromium, and until a server render through Vite's runner shows it (`hmr`, medians of 20 edits):

| grai's plugin | edit to page | edit to server render |
|---|---|---|
| app A | 15.0 ms | 11.5 ms |
| the synthetic project | 10.0 ms | 8.7 ms |

What that page keeps once collected, at load and after its 23 edits (`hmr`, Chromium 156). The same page with no messages keeps 1.4 MB:

| | grai's plugin | Paraglide | i18next | use-intl |
|---|---|---|---|---|
| app A, at load | 8.0 MB | 57.6 MB | 7.0 MB | 6.8 MB |
| app A, after the edits | 8.1 MB | 993.2 MB | 116.5 MB | 109.8 MB |
| app B, at load | 14.9 MB | 107.7 MB | 13.4 MB | 13.0 MB |
| app B, after the edits | 15.1 MB | 1,947.9 MB | 251.1 MB | 241.5 MB |

grai's dev page holds every locale of every key, and each call goes through a function that an edit's patch reaches. Over the page with no messages, that is 361 B a message (a key in one locale) on app A, 355 B on app B and 351 B on the synthetic project, and each edit adds 5.2–5.8 KB. i18next and use-intl hold only the page's locale, as a catalog they interpret when a message is called. They keep about 1 MB less at load on app A and 1.5 MB less on app B. Paraglide's dev output keeps about seven times as much as grai's. On every edit, those three pages import the changed modules again under new URLs, and a page keeps every module it has imported for as long as it is open. Each edit adds 4.5–10.3 MB for i18next and use-intl, and 41–80 MB for Paraglide. `hmr` holds grai's plugin to 400 B a message and 8 KB an edit, and exits with an error above either.

The designs grai's plugin was chosen from, as experiments of the bench's own compiler and watcher (`hmr`'s other rows, earlier runs):

| experiment | dev module | edit to page | of which the file watcher |
|---|---|---|---|
| app A, whole module re-evaluated | 1.9 MB | 202 ms | 48 ms |
| app A, patch, Vite's watcher | 1.9 MB | 123 ms | 114 ms |
| app A, patch, grai's `fs.watch` | 1.9 MB | 16.6 ms | 4.3 ms |
| app B, whole module re-evaluated | 4.3 MB | 459 ms | 78 ms |
| app B, patch, grai's `fs.watch` | 4.3 MB | 30.1 ms | 9.8 ms |

Vite's watcher alone takes 48–114 ms to report a save, and `fs.watch` 3–10 ms. With a patch, the browser's part is 2–3 ms whatever the module's size.

## Next.js

One App Router page, on grai, on next-intl 4.14 and with its words written in (`nextjs`, from `bench/next-apps.mjs`). It renders 400 messages in a server component and 100 in a client component, chosen evenly across the synthetic catalog, so it has the catalog's share of plurals and inputs, in `ru`. Next 16.4 with Turbopack, Chromium 156. next-intl's provider sends a client component every message of the locale unless the app picks them, so it is measured both ways. The bench installs grai from the repository's build, so it runs after `pnpm build` at the root.

What the page downloads, brotli:

| | document | scripts | total | more than the words written in |
|---|---|---|---|---|
| grai | 9.3 KB | 121.1 KB | 130.4 KB | 7.3 KB |
| next-intl, its default provider | 106.7 KB | 124.0 KB | 230.7 KB | 107.5 KB |
| next-intl, the client's keys picked | 10.5 KB | 124.0 KB | 134.6 KB | 11.4 KB |
| words written in | 9.2 KB | 113.9 KB | 123.2 KB | |

The server component's messages cost grai nothing beyond their HTML. The 7.3 KB is the runtime and the client component's 100 messages, each with all three locales' variants: Turbopack left out every other key of the catalog.

`next dev`, until ready and until the page's first response, from an empty `.next` and from the last run's; then one message edited in its catalog until the page shows it, the median of 7 edits, ms. One run, under a load of 3–6 from other work:

| | ready, empty `.next` | page | ready, `.next` kept | page | edit, server component | edit, client component |
|---|---|---|---|---|---|---|
| grai | 212 | 1,547 | 247 | 1,550 | 214 | 122 |
| next-intl | 222 | 1,238 | 221 | 1,178 | 154 | 154 |

- **grai's share of the start** is `withGrai`'s work when `next dev` asks for its config, its import included. With the output current, as on every start after the first, it holds Next back 14 ms, and the watch's first compile, which later edits start from, runs beside Next on a thread of its own: Next's thread spends 0.6 ms on grai once `withGrai` is back, where the watch on that thread took 28. From an empty outdir, it holds Next back 142 ms, until that same compile has written the output, so a start compiles once: 39 ms more than with the watch on Next's thread, the time its own thread takes to start, while Next's thread spends 30 ms on grai against 131. The watch's thread costs about 50 ms of CPU beside Next's (medians of 7, at a load of 16–19, against the watch on Next's thread).
- **An edit** reaches the shard grai rewrites in 4.5–4.6 ms, as the watcher compiles a save on its first event (`watch.ts`). The rest is Next noticing the shard and refreshing the page, as it notices and refreshes next-intl's catalog.
- **The page's first response** from an empty `.next` is slower on grai, here by 309 ms, and by 372 ms with `.next` kept: Turbopack compiles the output's 1.8 MB of message functions in each layer that imports them, where next-intl's catalog is JSON (`docs/followups.md`).

## Astro

One static Astro site, on grai, on Paraglide 2.29.1 in the setup its Astro guide gives for static sites, and with its words written in (`astro`, from `bench/astro-apps.mjs`). Each locale's page renders 400 messages in the page and 100 in a Svelte island, chosen evenly across the synthetic catalog, so it has the catalog's share of plurals and inputs; the page measured is `ru`'s. Astro 7.4.2, Chromium 156. The bench installs grai from the repository's build, so it runs after `pnpm build` at the root. One run, under a load of 10–18 from other work, so the times are rough.

`astro build` from a clean checkout, the median of 3, then what the page downloads, brotli:

| | build | document | scripts | total | more than the words written in |
|---|---|---|---|---|---|
| grai | 1,743 ms | 7.4 KB | 14.7 KB | 22.1 KB | 3.5 KB |
| Paraglide | 5,968 ms | 7.3 KB | 18.1 KB | 25.4 KB | 6.8 KB |
| words written in | 664 ms | 7.3 KB | 11.3 KB | 18.6 KB | |

The page's 400 messages cost grai nothing beyond their HTML. The 3.5 KB is the runtime and the island's 100 messages in `ru` alone, from their locale's copies of the message chunks through the import map. Paraglide's island holds every locale's words, as its per-locale build needs to own Vite's `buildApp`, which Astro owns.

`astro dev` from a clean checkout: until ready, then until the page's first response, then one message edited in its catalog until the open page shows it, the median of 7 edits, ms:

| | ready | first response | edit, in the page | edit, in the island |
|---|---|---|---|---|
| grai | 523 | 1,133 | 84 | 84 |
| Paraglide | 4,487 | 1,424 | not shown in 30 s | 3,797 |
| words written in | 813 | 631 | | |

- **grai** patches the dev server's messages and reloads the open page (`reloadOnEdit`), whose server render then has the edit.
- **Paraglide's edit in the page is never shown to the open page:** it recompiles the catalogs, about 5 s after the save, and a fresh request then renders the edit, but nothing reloads the page, so its words stay as they were until a reload by hand. Its island takes the edit through Vite's update of the island's module.

## Runtime size

The runtime the apps call (`getLocale`, `setLocale`, `locales`, `baseLocale`, `isLocale`, `localizeHref`, `deLocalizeUrl`), bundled for the browser (`runtime-size`): Paraglide's is 2,132 bytes min+gzip with a cookie strategy and 1,881 with a URL strategy, and grai's, as it compiles it, 677 and 719. The sketch the design started from, with the locale fixed per bundle, was 378.
