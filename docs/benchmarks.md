# Measured

Every chart here, and the README's, comes from benches anyone can run, on `bench/synthetic.mjs`'s catalog: `pnpm readme` in `bench/` runs them in one window and writes `bench/results/`, and `node scripts/charts.ts` draws the charts, their tables and the README's table at a glance from those files. Each file holds the date, the machine, the load and the libraries' versions it was measured with, and every sample.

How they compare, in every bench:
- **Rounds.** A bench measures each variant it compares once a round, in an order that rotates by one place from round to round, so that each takes every place alike (`bench/rounds.mjs`). In Node, each measurement runs in a process of its own.
- **Medians and intervals.** A figure is the median of its rounds, with the interval of order statistics that holds the median with 95% confidence (`bench/medians.mjs`); with fewer rounds than that needs, the lowest and highest sample, and the confidence they give, which the table names. A chart draws the interval as a whisker across its bar.
- **Pairs.** grai is compared with another variant round by round: their time over grai's in the same round, or for a start, grai's less theirs, so that load the two measurements of a round share cancels out. A comparison whose interval holds 1× (or 0 ms) is level.
- **Setups.** Each other library is measured in the setup its docs advise, and where a second setup is common, in that one too: next-intl with the client component's keys picked and with the whole catalog, i18next and use-intl with a page's own keys and with the whole catalog, and Paraglide's compile with declarations and without.
- **Checks.** Outside each clock, the bench checks what was measured: a compile's texts and declarations, a page's texts, a refactoring command's result.

Each section's numbers, under its charts, say what its clock measures; the sections come strongest first.

## The charts

<!-- charts:all -->
### Compiling after one edit

grai's recompile against Paraglide's Vite plugin in dev (locale modules), each from the compilation it kept.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/edit-compile-dark.svg">
  <img alt="One message edited, compiled again: 6,366 keys, grai 17 ms, Paraglide 2.89 s and Paraglide, declarations 32.7 s; 13,326 keys, grai 26 ms, Paraglide 6.55 s and Paraglide, declarations 233.0 s." src="assets/edit-compile-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | keys | its first compile | one message edited |
| --- | --- | --- | --- |
| grai | 6,366 | 159 ms (115 ms to 200 ms) | 17 ms (13 ms to 26 ms) |
| Paraglide's Vite plugin in dev, locale modules, without declarations | 6,366 | 3.49 s (3.43 s to 5.10 s) | 2.89 s (2.79 s to 4.69 s) |
| Paraglide's Vite plugin in dev, locale modules, declarations through TypeScript 6 | 6,366 | 42.9 s (35.3 s to 70.8 s) | 32.7 s (30.0 s to 65.3 s) |
| grai | 13,326 | 259 ms (173 ms to 454 ms) | 26 ms (17 ms to 129 ms) |
| Paraglide's Vite plugin in dev, locale modules, without declarations | 13,326 | 7.32 s (5.60 s to 9.56 s) | 6.55 s (5.32 s to 10.4 s) |
| Paraglide's Vite plugin in dev, locale modules, declarations through TypeScript 6 | 13,326 | 237.7 s (146.2 s to 416.3 s) | 233.0 s (165.8 s to 283.7 s) |

The same message edited each time, its text replaced as an editor saves it: grai compiles again by `recompile` from the build its compile before kept, as its Vite plugin and `grai watch` do; Paraglide's Vite plugin, as a dev server drives it, compiles again by its `watchChange` from the compilation it kept, in the layout it takes in development, locale modules, without declarations and with them. Medians of 6 rounds in rotating order, each in a new process (`bench/compile-time.mjs`).
</details>

### Choosing an ordinal

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/ordinals-dark.svg">
  <img alt="Choosing an ordinal form in ru: grai 4.3 ns, Intl.PluralRules, cached 110 ns and Paraglide 532 ns." src="assets/ordinals-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | ro, ns | ro, theirs over grai's | ru, ns | ru, theirs over grai's | en, ns | en, theirs over grai's |
| --- | --- | --- | --- | --- | --- | --- |
| grai | 1.3 ns |  | 4.3 ns |  | 13 ns |  |
| Paraglide | 601 ns | 478× (417× to 524×) | 532 ns | 134× (100× to 163×) | 720 ns | 59× (47× to 66×) |
| Intl.PluralRules, cached | 149 ns | 125× (105× to 142×) | 110 ns | 29× (21× to 37×) | 299 ns | 23× (18× to 29×) |

Each way of choosing an ordinal form is checked against `Intl.PluralRules` on 0 to 10,000 and on fractions, then timed on 0 to 999 in Node, in a process of its own once a round, in an order that rotates (`bench/ordinals.mjs`). grai's rule is the one its compiler writes; Paraglide 2.29.1's is its `registry.plural`; a cached `Intl.PluralRules` is what a library that calls Intl at best does.
</details>

### Compiling the catalogs

grai's output always carries each message's declarations, so the like-for-like row is Paraglide's compile with declarations, which it emits through TypeScript 6; its compile without them is beside it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/compile-dark.svg">
  <img alt="Compiling the catalogs: 6,366 keys, grai 159 ms, Paraglide 3.83 s and Paraglide, declarations 9.22 s; 13,326 keys, grai 259 ms, Paraglide 7.94 s and Paraglide, declarations 17.2 s." src="assets/compile-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | keys | full compile | nothing changed |
| --- | --- | --- | --- |
| grai | 6,366 | 159 ms (115 ms to 200 ms) | 2 ms (1 ms to 2 ms) |
| Paraglide, message modules, without declarations | 6,366 | 3.83 s (3.49 s to 5.81 s) | the same |
| Paraglide, message modules, declarations through TypeScript 6 | 6,366 | 9.22 s (7.79 s to 12.9 s) | the same |
| grai | 13,326 | 259 ms (173 ms to 454 ms) | 2 ms (2 ms to 4 ms) |
| Paraglide, message modules, without declarations | 13,326 | 7.94 s (6.00 s to 10.7 s) | the same |
| Paraglide, message modules, declarations through TypeScript 6 | 13,326 | 17.2 s (13.6 s to 33.0 s) | the same |

Each compile in a new Node process, timed once the library's modules have loaded, from the same restored catalogs and no output; the variants take turns in rounds whose order rotates, medians of 6 with the interval that holds each (`bench/compile-time.mjs`). Every output's texts and declarations are checked after its clock. Paraglide 2.29.1's compiler is in its production layout, message modules. The ratios in the table at a glance are Paraglide's time over grai's, paired by round.
</details>

### Choosing a plural

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/plurals-dark.svg">
  <img alt="Choosing a plural form in ru: grai 16 ns, Intl.PluralRules, cached 200 ns and Paraglide 548 ns." src="assets/plurals-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | ro, ns | ro, theirs over grai's | ru, ns | ru, theirs over grai's | en, ns | en, theirs over grai's |
| --- | --- | --- | --- | --- | --- | --- |
| grai | 6.5 ns |  | 16 ns |  | 4.5 ns |  |
| Paraglide | 757 ns | 116× (94× to 140×) | 548 ns | 39× (32× to 42×) | 508 ns | 116× (110× to 128×) |
| Intl.PluralRules, cached | 295 ns | 44× (39× to 55×) | 200 ns | 12× (7.8× to 18×) | 143 ns | 32× (21× to 42×) |

Each way of choosing a plural form is checked against `Intl.PluralRules` on 0 to 10,000 and on fractions, then timed on 0 to 999 in Node, in a process of its own once a round, in an order that rotates (`bench/plurals.mjs`). grai's rule is the one its compiler writes; Paraglide 2.29.1's is its `registry.plural`; a cached `Intl.PluralRules` is what a library that calls Intl at best does.
</details>

### Completing a key in the editor

In a file of 500 message calls, each library's keys typed its own way: completions as an editor asks TypeScript 6.0.3's language service for them, after `m.` or inside `t("`.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/types-prefix-dark.svg">
  <img alt="Completion after an edit: a typed prefix: 6,366 keys, grai 40 ms, Paraglide 386 ms, use-intl 19.5 s and i18next 37.0 s; 13,326 keys, grai 86 ms, Paraglide 1.64 s, use-intl 138.9 s and i18next 306.6 s." src="assets/types-prefix-light.svg" width="480">
</picture>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/types-next-dark.svg">
  <img alt="Repeated completion, file unchanged: 6,366 keys, use-intl 3 ms, i18next 5 ms, grai 27 ms and Paraglide 31 ms; 13,326 keys, use-intl 5 ms, i18next 10 ms, grai 61 ms and Paraglide 76 ms." src="assets/types-next-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | keys | first completion, the file opened | repeated completion, file unchanged | completion after an edit: a typed prefix | completion after an edit: a new call site | completion after an edit: a key added to the catalog | `tsc --noEmit` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| grai | 6,366 | 236 ms (226 ms to 241 ms, 75% interval) | 27 ms (26 ms to 27 ms, 75% interval) | 40 ms (39 ms to 42 ms, 75% interval) | 35 ms (34 ms to 38 ms, 75% interval) | 43 ms (37 ms to 44 ms, 75% interval) | 73 ms (72 ms to 78 ms, 75% interval) |
| Paraglide | 6,366 | 972 ms (939 ms to 1.09 s, 75% interval) | 31 ms (30 ms to 32 ms, 75% interval) | 386 ms (355 ms to 393 ms, 75% interval) | 386 ms (379 ms to 429 ms, 75% interval) | 839 ms (764 ms to 878 ms, 75% interval) | 285 ms (278 ms to 295 ms, 75% interval) |
| i18next | 6,366 | 35.7 s (32.5 s to 39.9 s, 75% interval) | 5 ms (5 ms to 6 ms, 75% interval) | 37.0 s (30.9 s to 40.6 s, 75% interval) | 39.5 s (35.8 s to 41.8 s, 75% interval) | 36.3 s (33.1 s to 37.4 s, 75% interval) | 612 ms (556 ms to 616 ms, 75% interval) |
| use-intl | 6,366 | 17.6 s (17.6 s to 21.7 s, 75% interval) | 3 ms (2 ms to 3 ms, 75% interval) | 19.5 s (19.2 s to 21.4 s, 75% interval) | 18.8 s (18.4 s to 21.0 s, 75% interval) | 20.1 s (19.7 s to 24.3 s, 75% interval) | 444 ms (440 ms to 596 ms, 75% interval) |
| grai | 13,326 | 388 ms (353 ms to 460 ms, 75% interval) | 61 ms (52 ms to 83 ms, 75% interval) | 86 ms (84 ms to 138 ms, 75% interval) | 83 ms (77 ms to 125 ms, 75% interval) | 81 ms (78 ms to 116 ms, 75% interval) | 88 ms (84 ms to 171 ms, 75% interval) |
| Paraglide | 13,326 | 3.83 s (3.24 s to 4.59 s, 75% interval) | 76 ms (67 ms to 130 ms, 75% interval) | 1.64 s (1.19 s to 2.47 s, 75% interval) | 1.25 s (1.21 s to 1.62 s, 75% interval) | 3.52 s (2.31 s to 4.37 s, 75% interval) | 828 ms (572 ms to 2.22 s, 75% interval) |
| i18next | 13,326 | 302.5 s (196.7 s to 307.6 s, 75% interval) | 10 ms (10 ms to 14 ms, 75% interval) | 306.6 s (175.0 s to 381.6 s, 75% interval) | 308.4 s (239.7 s to 336.5 s, 75% interval) | 313.6 s (203.4 s to 325.1 s, 75% interval) | 1.15 s (1.09 s to 1.39 s, 75% interval) |
| use-intl | 13,326 | 180.0 s (112.6 s to 189.0 s, 75% interval) | 5 ms (4 ms to 6 ms, 75% interval) | 138.9 s (105.8 s to 194.0 s, 75% interval) | 173.6 s (172.2 s to 197.0 s, 75% interval) | 159.7 s (121.3 s to 161.6 s, 75% interval) | 1.00 s (938 ms to 1.06 s, 75% interval) |

grai's and Paraglide's generated declarations, i18next's keys merged from the locale's JSON through `CustomTypeOptions`, and use-intl's inferred from the messages it is given, the types next-intl uses too (`bench/types.mjs`). Each sample is a new process, every library taking one a round in an order that rotates, medians of 3; with 3 rounds an interval is the lowest and highest sample, and holds the median with the confidence it names. Every list must hold exactly the keys the library's types give. TypeScript 7.0.2's language server answers the same completions too: its samples are in `bench/results/types-*.json`. `tsc --noEmit` is TypeScript 7.0.2's, its process included.
</details>

### A production build

What i18n adds to an app's production build, against the same app with every message's text written in. Each build is clocked from before Vite and the library's plugin are imported until the build has written its files; Node's own start is not in it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/build-added-dark.svg">
  <img alt="Time i18n adds to a production build: 6,366 keys, grai 0.62 s and Paraglide 3.98 s; 13,326 keys, grai 1.01 s and Paraglide 6.89 s." src="assets/build-added-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | keys | build | added | its plugins' buildStart | the rest |
| --- | --- | --- | --- | --- | --- |
| without i18n | 6,366 | 0.10 s (0.09 s to 0.13 s) |  |  |  |
| grai | 6,366 | 0.72 s (0.65 s to 0.88 s) | 0.62 s (0.55 s to 0.78 s) | 0.11 s (0.09 s to 0.13 s) | 0.51 s (0.46 s to 0.64 s) |
| Paraglide | 6,366 | 4.08 s (3.64 s to 4.42 s) | 3.98 s (3.54 s to 4.29 s) | 3.68 s (3.27 s to 3.94 s) | 0.30 s (0.26 s to 0.35 s) |
| without i18n | 13,326 | 0.11 s (0.10 s to 0.11 s) |  |  |  |
| grai | 13,326 | 1.11 s (1.06 s to 1.24 s) | 1.01 s (0.95 s to 1.11 s) | 0.17 s (0.17 s to 0.19 s) | 0.83 s (0.78 s to 0.92 s) |
| Paraglide | 13,326 | 7.00 s (6.91 s to 7.76 s) | 6.89 s (6.80 s to 7.64 s) | 6.42 s (6.27 s to 7.12 s) | 0.52 s (0.45 s to 0.58 s) |

Vite 8.3.5 (Rolldown 1.2.15) builds one app of 64 pages that call every key of the synthetic catalog, on grai, on Paraglide 2.29.1 and with every message's text written in, each build a new process from a clean checkout; the three take turns in rounds whose order rotates, medians of 9 with the interval that holds each (`bench/build-added.mjs`). Added is a build less the build without i18n of the same round. Its plugins' `buildStart`, where both compile the catalogs, is timed around the plugins' own hooks; the rest is everything else the library adds. After each build, outside its clock, every page is opened in Chromium and must draw its texts. Rolldown names a plugin hook of a second or more: in the median build, grai's none of 1 s or more, Paraglide's buildStart 6.40 s at 13,326 keys.
</details>

### An edit in development

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/dev-edit-dark.svg">
  <img alt="One message edited, until the DOM is updated: grai 18 ms, use-intl 69 ms, i18next 73 ms and Paraglide 3.88 s." src="assets/dev-edit-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | edit to the DOM updated | theirs over grai's, by round |
| --- | --- | --- |
| grai | 18 ms (15 ms to 19 ms) |  |
| Paraglide | 3.88 s (3.79 s to 3.96 s) | 199.20× (155.90× to 330.10×) |
| i18next | 73 ms (72 ms to 75 ms) | 4.16× (3.01× to 5.87×) |
| use-intl | 69 ms (65 ms to 72 ms) | 4.30× (3.35× to 5.24×) |

A catalog saved as an editor saves it until the page's MutationObserver in Chromium 156.0.8078.4 sees the edited text, 45 edits a design (`bench/hmr.mjs`). Each design's session takes its turn once a round, in an order that rotates, 9 rounds, each design's edits paired with grai's plugin's of the same round. grai patches the open page in place; Paraglide's plugin compiles again, and i18next and use-intl send the locale's catalog again.
</details>

### Next.js: an edit in development

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/next-edit-dark.svg">
  <img alt="Next.js: one message edited, until the page shows it: A server component, next-intl, keys picked 125 ms, next-intl, whole catalog 159 ms and grai 165 ms; A client component, grai 56 ms, next-intl, keys picked 129 ms and next-intl, whole catalog 160 ms." src="assets/next-edit-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | server component | client component |
| --- | --- | --- |
| grai | 165 ms (158 ms to 190 ms), written in 4.8 ms | 56 ms (54 ms to 63 ms), written in 4.2 ms |
| next-intl, keys picked | 125 ms (118 ms to 132 ms) | 129 ms (121 ms to 135 ms) |
| next-intl, whole catalog | 159 ms (148 ms to 177 ms) | 160 ms (149 ms to 167 ms) |

Next 16.4.3 with Turbopack, next-intl 4.14.9, a page of 400 messages in a server component and 100 in a client one, in `ru`. A catalog saved as an editor saves it until Chromium 156.0.8078.4 shows the edit in the open page, 18 edits an app, in sessions the apps take in rotating rounds, the components' order rotating too, each page checked whole after every edit (`bench/nextjs.mjs`). For grai, "written" is when the file holding the edit was written; the rest is Next's. "keys picked" is next-intl with the client component's keys picked, as its docs advise; "whole catalog" sends the client the locale's whole catalog, its default.
</details>

### A message call on a server

Kind by kind against Paraglide, in `ro` and `ru`, each ratio's interval taken from rounds: as an app calls them, grai is ahead on plurals; level on plain text and markup; ahead in one locale and not the other on messages with inputs. With each call given its locale, grai is ahead on plurals; level on messages with inputs and markup; behind on plain text.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/server-page-dark.svg">
  <img alt="A page's 2,000 message calls on a server: grai 34 ns, Paraglide 84 ns, i18next 2,255 ns and use-intl 4,080 ns." src="assets/server-page-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | locale | page's mix, ns | text, theirs over grai's | inputs, theirs over grai's | plural, theirs over grai's | markup, theirs over grai's |
| --- | --- | --- | --- | --- | --- | --- |
| grai | ro | 42 |  |  |  |  |
| Paraglide | ro | 85 | 1.2× (0.67× to 1.4×) | 1.7× (1.1× to 3.2×) | 16× (15× to 23×) | 0.94× (0.78× to 1.2×) |
| i18next | ro | 1,886 | 70× (40× to 93×) | 48× (37× to 123×) | 80× (67× to 88×) | — |
| use-intl | ro | 4,296 | 159× (80× to 182×) | 147× (77× to 188×) | 111× (89× to 166×) | 31× (24× to 35×) |
| Paraglide, given `{ locale }` | ro | 64 | 0.71× (0.52× to 0.81×) | 0.75× (0.54× to 1.1×) | 33× (21× to 39×) | 0.81× (0.66× to 1.0×) |
| grai, given `{ locale }` | ro | 24 |  |  |  |  |
| grai | ru | 34 |  |  |  |  |
| Paraglide | ru | 84 | 1.3× (0.90× to 2.4×) | 1.2× (0.95× to 1.6×) | 15× (10× to 16×) | 1.1× (0.99× to 1.5×) |
| i18next | ru | 2,255 | 82× (58× to 107×) | 49× (37× to 71×) | 77× (57× to 94×) | — |
| use-intl | ru | 4,080 | 139× (96× to 178×) | 82× (63× to 89×) | 119× (83× to 131×) | 30× (24× to 38×) |
| Paraglide, given `{ locale }` | ru | 54 | 0.65× (0.36× to 0.87×) | 0.70× (0.22× to 2.0×) | 20× (15× to 26×) | 1.2× (0.65× to 1.5×) |
| grai, given `{ locale }` | ru | 27 |  |  |  |  |

Each variant makes the same 2,000 calls inside a request in Node, built as an app's server build has them with its library's own plugins, its text checked against Paraglide's (`bench/server.mjs`). The clock is a warm batch inside one request: each run of the calls, divided by their number, after a warm-up. The page's mix is 1,318 text, 493 inputs, 104 plural and 85 markup calls. Each variant runs in a process of its own once a round, in an order that rotates; a ratio is the variant's calls over grai's of the same shape in the same round, given `{ locale }` against grai given it too. i18next draws no markup parts. Paraglide 2.29.1, i18next 26.4.7, use-intl 4.14.9.
</details>

### Next.js: a cold dev server's first page

Turbopack compiles grai's message functions in each layer that imports them, where next-intl's catalog is data. A built Next.js page is smaller on grai (in the numbers below).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/next-first-page-dark.svg">
  <img alt="Next.js: a cold next dev until the page's first response: next-intl, keys picked 2.43 s, grai 2.46 s, next-intl, whole catalog 2.53 s and grai, fresh clone 2.92 s." src="assets/next-first-page-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | first page | grai's less theirs, by round | built page download, brotli |
| --- | --- | --- | --- |
| grai | 2.46 s (1.64 s to 2.73 s) |  | 129.1 KB |
| next-intl, keys picked | 2.43 s (1.44 s to 2.66 s) | +77 ms (−185 ms to +310 ms) | 134.7 KB |
| next-intl, whole catalog | 2.53 s (1.52 s to 2.73 s) | −3 ms (−233 ms to +334 ms) | 230.8 KB |
| grai, fresh clone | 2.92 s (1.70 s to 3.21 s) |  | — |

Next 16.4.3 with Turbopack, next-intl 4.14.9, a page of 400 messages in a server component and 100 in a client one, in `ru`. `next dev` from an empty .next, from its launch until the page's first response is complete, the apps taking turns in rounds whose order rotates, 12 rounds, each pair's difference taken in the same round (`bench/nextjs.mjs`). grai's app starts with the groups of keys its watch saved; the fresh clone's starts with no output at all. "keys picked" is next-intl with the client component's keys picked, as its docs advise; "whole catalog" sends the client the locale's whole catalog, its default. The download is each app's page after `next build`, every response compressed with brotli.
</details>

### Hydrating a page

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/hydrate-dark.svg">
  <img alt="Hydrating a page of 2,000 message calls: grai 5.1 ms, Paraglide 8.6 ms, i18next, whole catalog 12.2 ms, i18next, page's keys 12.3 ms, use-intl, page's keys 17.9 ms and use-intl, whole catalog 18.3 ms." src="assets/hydrate-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | hydrates, ms | theirs over grai's |
| --- | --- | --- |
| grai | 5.1 ms |  |
| Paraglide | 8.6 ms | 1.7× (1.6× to 1.8×) |
| i18next, page's keys | 12.3 ms | 2.4× (2.3× to 2.6×) |
| use-intl, page's keys | 17.9 ms | 3.6× (3.3× to 3.7×) |
| i18next, whole catalog | 12.2 ms | 2.4× (2.4× to 2.6×) |
| use-intl, whole catalog | 18.3 ms | 3.5× (3.4× to 3.8×) |

The page of the chart above, in Chromium 156.0.8078.4, no CPU slowdown, in `ru` (`bench/hydrate.mjs`): `hydrate` timed from when every module has been evaluated until it returns, Svelte's recovery off. Each variant loads in a browser of its own once a round, in an order that rotates, 16 rounds; ratios are each variant's over grai's in the same round. Its rows at a fourfold CPU slowdown are in `bench/results/hydrate-synthetic.json`.
</details>

### A server render

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/ssr-dark.svg">
  <img alt="A warm server render of a page of 2,000 message calls: grai 0.14 ms, Paraglide 0.19 ms, i18next 4.4 ms and use-intl 7.4 ms." src="assets/ssr-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | ro, ms | ro, theirs over grai's | ru, ms | ru, theirs over grai's |
| --- | --- | --- | --- | --- |
| grai | 0.15 ms |  | 0.14 ms |  |
| Paraglide | 0.20 ms | 1.3× (1.1× to 1.5×) | 0.19 ms | 1.4× (1.1× to 1.9×) |
| i18next | 4.6 ms | 29× (26× to 37×) | 4.4 ms | 33× (22× to 54×) |
| use-intl | 5.8 ms | 43× (31× to 47×) | 7.4 ms | 59× (36× to 74×) |
| the words written into the page | 0.05 ms | 0.29× (0.25× to 0.43×) | 0.04 ms | 0.32× (0.24× to 0.43×) |

Svelte renders one page of 2,000 message calls inside a request already open, as an app built with Vite renders it, its messages from each library built with its own plugins (`bench/ssr.mjs`). The clock is a warm render, `render(Page, { props })` after a warm-up; compiling, imports, the libraries' setup and the middleware are outside it. Each variant renders in a process of its own once a round, in an order that rotates; medians of the rounds with the interval that holds each, and each variant's ratio to grai's in the same round. The last row writes each message without a selector into the template. Paraglide 2.29.1, i18next 26.4.7, use-intl 4.14.9.
</details>

### What a page downloads

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/page-js-dark.svg">
  <img alt="A page of 2,000 message calls, 416 distinct keys: its JS: grai 24.7 KB, use-intl, page's keys 34.2 KB, i18next, page's keys 36.2 KB, Paraglide 36.8 KB, use-intl, whole catalog 127.1 KB and i18next, whole catalog 129.3 KB." src="assets/page-js-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | JS, KB brotli | JS, KB |
| --- | --- | --- |
| grai | 24.7 | 101 |
| Paraglide | 36.8 | 170 |
| i18next, page's keys | 36.2 | 155 |
| use-intl, page's keys | 34.2 | 150 |
| i18next, whole catalog | 129.3 | 681 |
| use-intl, whole catalog | 127.1 | 681 |

One Svelte page built with Vite, each library's build with its own plugins, served as the build wrote it with the server's render drawn in, loaded in Chromium in `ru` (`bench/hydrate.mjs`). Its JS is every script it loads, each compressed on its own with brotli, and those its index.html holds inline. grai's page loads its locale's copies of the message chunks, as `@xyrolle/grai/sveltekit` serves them; i18next and use-intl load the page's own keys, as both advise, or the locale's whole catalog.
</details>

### The runtime

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/runtime-dark.svg">
  <img alt="The runtime a page needs to show a text, an input and a plural: In a page that shows a text, an input and a plural, grai 1.4 KB, Paraglide 1.8 KB, use-intl 10.2 KB and i18next 12.2 KB; Every export, bundled alone, grai 0.6 KB, Paraglide 3.6 KB, use-intl 10.2 KB and i18next 12.1 KB." src="assets/runtime-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | KB brotli | KB |
| --- | --- | --- |
| grai, as its build writes the locale's copies | 1.4 | 3.3 |
| Paraglide, every locale | 1.8 | 4.7 |
| i18next | 12.2 | 42.8 |
| use-intl | 10.2 | 38.2 |
| grai, runtime.js with every export, alone | 0.6 | 1.4 |
| Paraglide, runtime.js with every export, alone | 3.6 | 10.4 |
| i18next, init and t, alone | 12.1 | 42.5 |
| use-intl, createTranslator, alone | 10.2 | 38.1 |

The runtime is what a library adds to a page that shows three messages, a plain text, a text with an input and a plural: the page's JS, built as an app's client build makes it with the library's own plugins and loaded in Chromium, less the same page's with the three texts written in (`bench/library-bytes.mjs`, in `ru`). Below it, the modules this figure once stood for, each bundled alone by Rolldown for the browser: grai's and Paraglide's runtime modules with every export, i18next set up with `init` and `t`, and use-intl's `createTranslator`.
</details>

### Starting the dev server

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/dev-start-dark.svg">
  <img alt="A Vite dev server, until its page shows: A first start, 500 plain texts, use-intl 196 ms, i18next 202 ms, grai 233 ms and Paraglide 5.35 s; A restart, 500 plain texts, use-intl 154 ms, i18next 155 ms, grai 173 ms and Paraglide 5.65 s; A first start, 500 calls in the catalog's mix, i18next 187 ms, use-intl 195 ms, grai 217 ms and Paraglide 4.75 s." src="assets/dev-start-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | start | until shown | grai's less theirs, by round |
| --- | --- | --- | --- |
| grai | A first start, 500 plain texts | 233 ms (216 ms to 265 ms) |  |
| Paraglide | A first start, 500 plain texts | 5.35 s (4.90 s to 5.72 s) | −5,106 ms (−5,496 ms to −4,688 ms) |
| i18next | A first start, 500 plain texts | 202 ms (191 ms to 231 ms) | +34 ms (−6 ms to +41 ms) |
| use-intl | A first start, 500 plain texts | 196 ms (190 ms to 216 ms) | +38 ms (+18 ms to +49 ms) |
| no messages | A first start, 500 plain texts | 94 ms (87 ms to 114 ms) | +140 ms (+111 ms to +165 ms) |
| grai | A restart, 500 plain texts | 173 ms (145 ms to 244 ms) |  |
| Paraglide | A restart, 500 plain texts | 5.65 s (5.07 s to 6.70 s) | −5,475 ms (−6,511 ms to −4,882 ms) |
| i18next | A restart, 500 plain texts | 155 ms (134 ms to 170 ms) | +16 ms (−11 ms to +110 ms) |
| use-intl | A restart, 500 plain texts | 154 ms (143 ms to 164 ms) | +16 ms (+5 ms to +90 ms) |
| no messages | A restart, 500 plain texts | 95 ms (83 ms to 140 ms) | +79 ms (+20 ms to +151 ms) |
| grai | A first start, 500 calls in the catalog's mix | 217 ms (175 ms to 233 ms) |  |
| Paraglide | A first start, 500 calls in the catalog's mix | 4.75 s (4.01 s to 7.95 s) | −4,534 ms (−7,636 ms to −3,832 ms) |
| i18next | A first start, 500 calls in the catalog's mix | 187 ms (154 ms to 194 ms) | +37 ms (−10 ms to +53 ms) |
| use-intl | A first start, 500 calls in the catalog's mix | 195 ms (168 ms to 224 ms) | +14 ms (−19 ms to +63 ms) |
| no messages | A first start, 500 calls in the catalog's mix | 85 ms (69 ms to 96 ms) | +135 ms (+82 ms to +154 ms) |

Each start is a new Node process, timed from the import of its library's Vite plugin, as an app's config imports it before its server starts, once Vite and Chromium have loaded, until the frame drawn after the page's texts are in the DOM (`bench/dev-start.mjs`). A first start is in a new directory with no output and no cache, Vite's own among them; a restart follows a first start of its own library and keeps what it wrote. i18next and use-intl have no plugin to import and load the locale's catalog in the page. Every library starts once a round, in an order that rotates; medians with the interval that holds each, and grai's start less each other's of the same round. The page with no messages draws the same texts from its own code.
</details>

### The refactoring commands

A cold check parses every file that may read messages and resolves its imports, which is what makes its reads exact, and costs seconds on a large project. Keep the facts it writes in CI's cache ([the guide's CI section](guide.md#ci)), and a check reads only the files that changed.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/check-dark.svg">
  <img alt="grai's commands on 13,000 keys and 9,000 files: grai check, cold 3.37 s and warm 0.78 s; grai find, cold 3.57 s and warm 0.70 s; grai rename, cold 3.32 s and warm 0.73 s; grai check --fix, cold 3.25 s and warm 0.89 s." src="assets/check-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | no facts or file listing kept | what the run before left |
| --- | --- | --- |
| `grai check --json` | 3.37 s (2.81 s to 4.08 s) | 0.78 s (0.60 s to 1.06 s) |
| `grai find area70_label_5793` | 3.57 s (3.14 s to 3.90 s) | 0.70 s (0.62 s to 0.75 s) |
| `grai rename area70_label_5793 area70_label_5793_x` | 3.32 s (3.09 s to 4.60 s) | 0.73 s (0.62 s to 0.77 s) |
| `grai check --fix` | 3.25 s (3.05 s to 3.44 s) | 0.89 s (0.75 s to 0.92 s) |

Grai's CLI in a new Node process, from its launch until it exits, on a synthetic project of 13,000 keys in three locales and 9,000 source files; cold and warm interleaved in rounds whose order rotates, medians of 6 with the interval that holds each (`bench/refactor.mjs`). Cold keeps nothing grai keeps between commands; the compiled output and the file system's caches stay. Each result is checked exactly after its clock.
</details>
<!-- /charts:all -->

## Two production apps

The benches that take an app run on two production apps' catalogs too, app A's (6,379 keys) and app B's (13,326 keys), where `GRAI_BENCH_A` and `GRAI_BENCH_B` name their checkouts. The apps are private, so their results are not published here; the synthetic catalog has app A's shares of plurals, inputs and markup, and the 13,326-key charts app B's size.
