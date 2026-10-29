# grai

Translations compiled ahead of time into typed functions, for any JavaScript framework. A page loads only the messages it calls, in its own locale.

*Grai* (Romanian) is a people's way of speaking.

```json
{
  "cart_title": "Your cart",
  "cart_items": "{count :number} items",
  "greeting": "Hello {name}"
}
```

```ts
import { m } from "./src/lib/i18n/messages.js";

m.cart_title();                                // "Your cart"
m.cart_items({ count: 3 });                    // "3 items"
m.greeting({ name: "Ana" }, { locale: "ro" }); // the Romanian message
m.greeting({});                                // type error: `name` is missing
m.cart_items({ count: "3" });                  // type error: `count` is a number
m.cart_titel();                                // type error: no such key
```

## At a glance

Every measure the benches take, where lower is better: grai's figure, the best of the others' in the setup its docs advise, and how the two compare. A time is compared round by round, the two measured in the same round: their time over grai's, or for a start, grai's less theirs, with the interval that holds the median with 95% confidence unless it names another. A row whose interval holds 1× (or 0 ms) is level, and one clear of it on grai's side is marked behind. A size is exact. The strongest come first; each measure links to its chart, and the [Performance](#performance) section says how they were run.

<!-- glance -->
| Measure | grai | Best of the others | Compared |
| --- | --- | --- | --- |
| [Compile after one edit, 13,326 keys, Paraglide's default](docs/benchmarks.md#compiling-after-one-edit) | 13 ms | 7.45 s (Paraglide's Vite plugin in dev, without declarations, its default) | 623× (351× to 1,175×) |
| [Compile after one edit, 13,326 keys, both emit declarations](docs/benchmarks.md#compiling-after-one-edit) | 13 ms | 248.2 s (Paraglide's Vite plugin in dev, declarations through TypeScript 6) | 21,568× (14,275× to 41,391×) |
| [An ordinal form chosen, `ru`](docs/benchmarks.md#choosing-an-ordinal) | 3.3 ns | 501 ns (Paraglide) | 149× (144× to 163×) |
| [Full compile, 13,326 keys, both emit declarations](#compiling-the-catalogs) | 264 ms | 19.2 s (Paraglide with declarations) | 72× (55× to 226×) |
| [Full compile, 13,326 keys, Paraglide without declarations](#compiling-the-catalogs) | 264 ms | 8.59 s (Paraglide without declarations) | 35× (26× to 44×) |
| [A plural form chosen, `ru`](docs/benchmarks.md#choosing-a-plural) | 15 ns | 551 ns (Paraglide) | 37× (7.8× to 43×) |
| [Editor: completion after an edit (a typed prefix), 13,326 keys](docs/benchmarks.md#completing-a-key-in-the-editor) | 96 ms | 1.46 s (Paraglide) | 13× (11× to 19×) |
| [Time i18n adds to a production build, 13,326 keys](#a-production-build) | 1.10 s | 7.71 s (Paraglide) | 6.8× (6.3× to 7.6×) |
| [`tsc --noEmit` on 500 calls, 13,326 keys](docs/benchmarks.md#completing-a-key-in-the-editor) | 120 ms | 836 ms (Paraglide) | 6.7× (4.6× to 11×) |
| [Next.js dev: an edit in a client component, until shown](docs/benchmarks.md#nextjs-an-edit-in-development) | 43 ms | 148 ms (next-intl with the client's keys picked, as its docs advise) | 3.5× (3.3× to 4.4×) |
| [Next.js dev: an edit in a client component, until shown](docs/benchmarks.md#nextjs-an-edit-in-development) | 43 ms | 176 ms (next-intl with the whole catalog) | 4.1× (3.4× to 5.5×) |
| [Vite dev: one message edited, until the DOM is updated](#an-edit-in-development) | 17 ms | 72 ms (use-intl) | 3.9× (3.1× to 5.0×) |
| [Server: a message call, the page's mix, warm](#a-message-call-on-a-server) | 17 ns | 55 ns (Paraglide) | 3.1× (1.07× to 3.3×) |
| [Next.js: a built page's download, brotli](#nextjs-a-cold-dev-servers-first-page) | 129.1 KB | 134.7 KB (next-intl with the client's keys picked, as its docs advise) | 1.04× |
| [Next.js: a built page's download, brotli](#nextjs-a-cold-dev-servers-first-page) | 129.1 KB | 230.8 KB (next-intl with the whole catalog) | 1.79× |
| [Hydration, 2,000 message calls](docs/benchmarks.md#hydrating-a-page) | 5.9 ms | 9.8 ms (Paraglide) | 1.69× (1.59× to 1.80×) |
| [Next.js dev: an edit in a server component, until shown](docs/benchmarks.md#nextjs-an-edit-in-development) | 122 ms | 148 ms (next-intl with the client's keys picked, as its docs advise) | 1.18× (1.11× to 1.44×) |
| [Next.js dev: an edit in a server component, until shown](docs/benchmarks.md#nextjs-an-edit-in-development) | 122 ms | 177 ms (next-intl with the whole catalog) | 1.49× (1.07× to 1.65×) |
| [Page JS, 2,000 message calls, 416 distinct keys, brotli](#what-a-page-downloads) | 24.7 KB | 34.2 KB (use-intl, page's keys) | 1.38× |
| [Runtime a page needs to show a text, an input and a plural, brotli](docs/benchmarks.md#the-runtime) | 1.4 KB | 1.8 KB (Paraglide) | 1.29× |
| [Server render, 2,000 message calls, warm, `ru`](#a-server-render) | 0.14 ms | 0.17 ms (Paraglide) | 1.25× (1.04× to 1.64×) |
| [Next.js dev: a cold start's first page](#nextjs-a-cold-dev-servers-first-page) | 1.96 s | 1.97 s (next-intl with the client's keys picked, as its docs advise) | level (−308 ms to +157 ms) |
| [Next.js dev: a cold start's first page](#nextjs-a-cold-dev-servers-first-page) | 1.96 s | 1.83 s (next-intl with the whole catalog) | level (−186 ms to +419 ms) |
| [Vite dev: a restart, until its page shows](docs/benchmarks.md#starting-the-dev-server) | 162 ms | 153 ms (use-intl) | level (−52 ms to +35 ms) |
| [Vite dev: a first start, until its page shows](docs/benchmarks.md#starting-the-dev-server) | 179 ms | 161 ms (i18next) | level (−71 ms to +43 ms) |
| [Editor: repeated completion, file unchanged, 13,326 keys](docs/benchmarks.md#completing-a-key-in-the-editor) | 69 ms | 5 ms (use-intl) | 0.07× (0.04× to 0.09×), behind |
<!-- /glance -->

## Why grai

- **A page ships only the messages it calls.** The build splits the catalog by key and by locale: a page of 2,000 message calls of 416 distinct keys loads <!-- value:page-grai -->24.7 KB<!-- /value --> of JavaScript, brotli, against <!-- value:page-paraglide -->36.8 KB<!-- /value --> on Paraglide and <!-- value:page-i18next -->36.2 KB<!-- /value --> on i18next with the page's own keys.
- **A small runtime.** What a page needs to show a text, an input and a plural is <!-- value:runtime-grai -->1.4 KB<!-- /value --> brotli, against <!-- value:runtime-paraglide -->1.8 KB<!-- /value --> on Paraglide, <!-- value:runtime-use-intl -->10.2 KB<!-- /value --> on use-intl and <!-- value:runtime-i18next -->12.2 KB<!-- /value --> on i18next.
- **Typed MessageFormat 2,** the Unicode standard: plurals, selects, number, date and list formatting, and markup. A message is a function typed by its inputs, so a missing or mistyped input is an error where it is called, and a plural takes <!-- value:plural-grai -->29 ns<!-- /value --> on a server, against <!-- value:plural-paraglide -->585 ns<!-- /value --> on Paraglide.
- **Refactoring that reads code as the bundler does.** `grai check`, `check --fix`, `find`, `rename` and `migrate` parse each file and follow its imports, so a key a comment mentions is no read, and `check --fix` never removes a key a page calls. A check of a 13,000-key, 9,000-file project takes <!-- value:check-warm -->0.48 s<!-- /value --> once its facts are kept.
- **Edits in place.** An edited message is in the open page's DOM <!-- value:dev-grai -->17 ms<!-- /value --> after its catalog is saved, without a reload; on Paraglide, its plugin compiles again and the edit takes <!-- value:dev-paraglide -->4.13 s<!-- /value -->.
- **Adapters for six frameworks:** SvelteKit, Next.js, Nuxt, Astro, Vue and React, a Vite plugin for any other app, and a middleware for Workers, Bun, Deno and Node.

## Quick start

```sh
pnpm add -D @xyrolle/grai
```

Its commands and plugins need Node 22.18 or later. The output's `server.js` imports `node:async_hooks`, so a project whose type checker reads the output's JavaScript, as a SvelteKit app's reads all of `src`, needs Node's types too: `pnpm add -D @types/node`.

Catalogs are the inlang message format, one JSON file per locale, as Paraglide reads them, and `grai.config.json` names them:

```json
{
  "$schema": "./node_modules/@xyrolle/grai/config.schema.json",
  "locales": ["en", "ro"],
  "baseLocale": "en",
  "catalogs": "messages/{locale}.json",
  "outdir": "src/lib/i18n"
}
```

Then add grai to the app:

| Framework | What to add | Docs |
|---|---|---|
| SvelteKit | `grai()` from `@xyrolle/grai/sveltekit/vite` before `sveltekit()`, and `handleLocale` in `hooks.server.ts` | [SvelteKit](docs/frameworks.md#sveltekit) |
| Next.js | `withGrai(config)` from `@xyrolle/grai/next/config`, the proxy from `@xyrolle/grai/next/proxy`, and `bindLocale` in each layout and page | [Next.js](docs/frameworks.md#nextjs) |
| Nuxt | `modules: ["@xyrolle/grai/nuxt"]` | [Nuxt](docs/frameworks.md#nuxt) |
| Astro | `integrations: [grai()]` from `@xyrolle/grai/astro` | [Astro](docs/frameworks.md#astro) |
| Vue | `grai()` from `@xyrolle/grai/vite`, and `Markup` from `@xyrolle/grai/vue` | [Vue](docs/frameworks.md#vue) |
| React | `Markup` from `@xyrolle/grai/react`, beside Next.js or Vite | [Next.js](docs/frameworks.md#nextjs) |
| Any Vite app | `plugins: [grai()]` from `@xyrolle/grai/vite` | [Vite](docs/frameworks.md#vite) |
| Workers, Bun, Deno and Node | `middleware` from the output's `server.js` | [Servers](docs/frameworks.md#workers-bun-deno-and-node) |

`grai compile` writes the output, and `grai watch` writes it again on each edit; each adapter does both for you. The [guide](docs/guide.md) covers the commands, a static site's locale, tests and CI, and [docs/config.md](docs/config.md) every field of the config.

## Performance

Every number here comes from a bench in [`bench/`](bench), run in one window on <!-- value:bench-date -->28–29 Oct 2026<!-- /value --> on <!-- value:bench-machine -->an Apple M5 Pro with 18 cores<!-- /value -->, beside other work: its one-minute load was <!-- value:bench-load -->6 to 34<!-- /value --> through the window.<!-- value:bench-after --><!-- /value --> The catalog is `bench/synthetic.mjs`'s, 6,366 keys in three locales with a production app's shares of plurals, inputs and markup, and the same shares at 13,326 keys where a chart groups by size, so anyone can run them. `bench/results/` holds what each run recorded, with its versions and load, and `node scripts/charts.ts` draws the charts and the table above from it.

<!-- charts:readme -->
### Compiling the catalogs

grai's output always carries each message's declarations, so the like-for-like row is Paraglide's compile with declarations, which it emits through TypeScript 6; its compile without them is beside it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/compile-dark.svg">
  <img alt="Compiling the catalogs: 6,366 keys, grai 111 ms, Paraglide 4.09 s and Paraglide, declarations 8.17 s; 13,326 keys, grai 264 ms, Paraglide 8.59 s and Paraglide, declarations 19.2 s." src="docs/assets/compile-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | keys | full compile | nothing changed |
| --- | --- | --- | --- |
| grai | 6,366 | 111 ms (93 ms to 122 ms) | 2 ms (1 ms to 2 ms) |
| Paraglide, message modules, without declarations | 6,366 | 4.09 s (3.59 s to 4.85 s) | the same |
| Paraglide, message modules, declarations through TypeScript 6 | 6,366 | 8.17 s (7.59 s to 9.44 s) | the same |
| grai | 13,326 | 264 ms (167 ms to 315 ms) | 4 ms (2 ms to 4 ms) |
| Paraglide, message modules, without declarations | 13,326 | 8.59 s (6.26 s to 10.7 s) | the same |
| Paraglide, message modules, declarations through TypeScript 6 | 13,326 | 19.2 s (13.6 s to 37.7 s) | the same |

Each compile in a new Node process, timed once the library's modules have loaded, from the same restored catalogs and no output; the variants take turns in rounds whose order rotates, medians of 6 with the interval that holds each (`bench/compile-time.mjs`). Every output's texts and declarations are checked after its clock. Paraglide 2.29.1's compiler is in its production layout, message modules. The ratios in the table at a glance are Paraglide's time over grai's, paired by round.
</details>

### A production build

What i18n adds to an app's production build, against the same app with every message's text written in. Each build is clocked from before Vite and the library's plugin are imported until the build has written its files; Node's own start is not in it.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/build-added-dark.svg">
  <img alt="Time i18n adds to a production build: 6,366 keys, grai 0.80 s and Paraglide 4.52 s; 13,326 keys, grai 1.10 s and Paraglide 7.71 s." src="docs/assets/build-added-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | keys | build | added | its plugins' buildStart | the rest |
| --- | --- | --- | --- | --- | --- |
| without i18n | 6,366 | 0.12 s (0.11 s to 0.14 s) |  |  |  |
| grai | 6,366 | 0.92 s (0.78 s to 1.41 s) | 0.80 s (0.64 s to 1.27 s) | 0.12 s (0.10 s to 0.15 s) | 0.68 s (0.54 s to 1.12 s) |
| Paraglide | 6,366 | 4.64 s (4.13 s to 6.23 s) | 4.52 s (4.03 s to 6.09 s) | 4.11 s (3.73 s to 5.43 s) | 0.41 s (0.29 s to 0.74 s) |
| without i18n | 13,326 | 0.11 s (0.10 s to 0.11 s) |  |  |  |
| grai | 13,326 | 1.21 s (1.18 s to 1.42 s) | 1.10 s (1.08 s to 1.32 s) | 0.18 s (0.17 s to 0.23 s) | 0.93 s (0.90 s to 1.09 s) |
| Paraglide | 13,326 | 7.82 s (7.42 s to 8.48 s) | 7.71 s (7.32 s to 8.38 s) | 7.19 s (6.82 s to 7.90 s) | 0.53 s (0.49 s to 0.59 s) |

Vite 8.3.5 (Rolldown 1.2.15) builds one app of 64 pages that call every key of the synthetic catalog, on grai, on Paraglide 2.29.1 and with every message's text written in, each build a new process from a clean checkout; the three take turns in rounds whose order rotates, medians of 9 with the interval that holds each (`bench/build-added.mjs`). Added is a build less the build without i18n of the same round. Its plugins' `buildStart`, where both compile the catalogs, is timed around the plugins' own hooks; the rest is everything else the library adds. After each build, outside its clock, every page is opened in Chromium and must draw its texts. Rolldown names a plugin hook of a second or more: in the median build, grai's none of 1 s or more, Paraglide's buildStart 7.20 s at 13,326 keys.
</details>

### An edit in development

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dev-edit-dark.svg">
  <img alt="One message edited, until the DOM is updated: grai 17 ms, use-intl 72 ms, i18next 82 ms and Paraglide 4.13 s." src="docs/assets/dev-edit-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | edit to the DOM updated | theirs over grai's, by round |
| --- | --- | --- |
| grai | 17 ms (16 ms to 20 ms) |  |
| Paraglide | 4.13 s (4.01 s to 4.25 s) | 224.50× (201.80× to 300.20×) |
| i18next | 82 ms (77 ms to 86 ms) | 4.96× (3.13× to 6.33×) |
| use-intl | 72 ms (66 ms to 77 ms) | 3.86× (3.14× to 5.00×) |

A catalog saved as an editor saves it until the page's MutationObserver in Chromium 156.0.8078.4 sees the edited text, 45 edits a design (`bench/hmr.mjs`). Each design's session takes its turn once a round, in an order that rotates, 9 rounds, each design's edits paired with grai's plugin's of the same round. grai patches the open page in place; Paraglide's plugin compiles again, and i18next and use-intl send the locale's catalog again.
</details>

### A message call on a server

Kind by kind against Paraglide, in `ro` and `ru`, each ratio's interval taken from rounds: as an app calls them, grai is ahead on plurals; level on plain text and markup; ahead in one locale and not the other on messages with inputs. With each call given its locale, grai is ahead on plurals; level on markup; ahead in one locale and not the other on plain text and messages with inputs.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/server-page-dark.svg">
  <img alt="A page's 2,000 message calls on a server: grai 17 ns, Paraglide 55 ns, i18next 2,331 ns and use-intl 3,492 ns." src="docs/assets/server-page-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | locale | page's mix, ns | text, theirs over grai's | inputs, theirs over grai's | plural, theirs over grai's | markup, theirs over grai's |
| --- | --- | --- | --- | --- | --- | --- |
| grai | ro | 20 |  |  |  |  |
| Paraglide | ro | 64 | 1.05× (0.49× to 2.6×) | 1.97× (0.72× to 4.1×) | 20× (15× to 31×) | 1.08× (0.42× to 1.30×) |
| i18next | ro | 1,852 | 77× (53× to 150×) | 61× (29× to 115×) | 97× (80× to 120×) | — |
| use-intl | ro | 3,856 | 125× (108× to 202×) | 99× (55× to 190×) | 125× (82× to 149×) | 37× (20× to 49×) |
| Paraglide, given `{ locale }` | ro | 46 | 0.73× (0.33× to 0.95×) | 0.73× (0.42× to 0.92×) | 24× (18× to 47×) | 0.88× (0.41× to 1.19×) |
| grai, given `{ locale }` | ro | 13 |  |  |  |  |
| grai | ru | 17 |  |  |  |  |
| Paraglide | ru | 55 | 1.16× (0.78× to 1.62×) | 2.3× (1.11× to 3.4×) | 19× (11× to 25×) | 1.10× (0.93× to 1.30×) |
| i18next | ru | 2,331 | 89× (49× to 130×) | 88× (37× to 125×) | 93× (57× to 138×) | — |
| use-intl | ru | 3,492 | 161× (78× to 209×) | 131× (67× to 465×) | 126× (83× to 173×) | 36× (21× to 147×) |
| Paraglide, given `{ locale }` | ru | 48 | 0.70× (0.38× to 1.34×) | 0.61× (0.29× to 1.29×) | 22× (15× to 29×) | 1.08× (0.75× to 1.28×) |
| grai, given `{ locale }` | ru | 26 |  |  |  |  |

Each variant makes the same 2,000 calls inside a request in Node, built as an app's server build has them with its library's own plugins, its text checked against Paraglide's (`bench/server.mjs`). The clock is a warm batch inside one request: each run of the calls, divided by their number, after a warm-up. The page's mix is 1,318 text, 493 inputs, 104 plural and 85 markup calls. Each variant runs in a process of its own once a round, in an order that rotates; a ratio is the variant's calls over grai's of the same shape in the same round, given `{ locale }` against grai given it too. i18next draws no markup parts. Paraglide 2.29.1, i18next 26.4.7, use-intl 4.14.9.
</details>

### Next.js: a cold dev server's first page

next-intl in both its setups: with the client component's keys picked, as its docs advise, and with the whole catalog, its default.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/next-first-page-dark.svg">
  <img alt="Next.js: a cold next dev until the page's first response: next-intl, whole catalog 1.83 s, grai 1.96 s, next-intl, keys picked 1.97 s and grai, fresh clone 2.06 s." src="docs/assets/next-first-page-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | first page | grai's less theirs, by round | built page download, brotli |
| --- | --- | --- | --- |
| grai | 1.96 s (1.64 s to 2.44 s) |  | 129.1 KB |
| next-intl, keys picked | 1.97 s (1.85 s to 2.29 s) | −98 ms (−308 ms to +157 ms) | 134.7 KB |
| next-intl, whole catalog | 1.83 s (1.68 s to 2.12 s) | +135 ms (−186 ms to +419 ms) | 230.8 KB |
| grai, fresh clone | 2.06 s (1.95 s to 2.24 s) |  | — |

Next 16.4.3 with Turbopack, next-intl 4.14.9, a page of 400 messages in a server component and 100 in a client one, in `ru`. `next dev` from an empty .next, from its launch until the page's first response is complete, the apps taking turns in rounds whose order rotates, 12 rounds, each pair's difference taken in the same round (`bench/nextjs.mjs`). grai's app starts with the groups of keys its watch saved; the fresh clone's starts with no output at all. "keys picked" is next-intl with the client component's keys picked, as its docs advise; "whole catalog" sends the client the locale's whole catalog, its default. The download is each app's page after `next build`, every response compressed with brotli.
</details>

### What a page downloads

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/page-js-dark.svg">
  <img alt="A page of 2,000 message calls, 416 distinct keys: its JS: grai 24.7 KB, use-intl, page's keys 34.2 KB, i18next, page's keys 36.2 KB, Paraglide 36.8 KB, use-intl, whole catalog 127.1 KB and i18next, whole catalog 129.3 KB." src="docs/assets/page-js-light.svg" width="480">
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

### A server render

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/ssr-dark.svg">
  <img alt="A warm server render of a page of 2,000 message calls: grai 0.14 ms, Paraglide 0.17 ms, i18next 4.2 ms and use-intl 6.1 ms." src="docs/assets/ssr-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | ro, ms | ro, theirs over grai's | ru, ms | ru, theirs over grai's |
| --- | --- | --- | --- | --- |
| grai | 0.15 ms |  | 0.14 ms |  |
| Paraglide | 0.19 ms | 1.19× (0.97× to 1.70×) | 0.17 ms | 1.25× (1.04× to 1.64×) |
| i18next | 4.5 ms | 30× (27× to 41×) | 4.2 ms | 31× (24× to 42×) |
| use-intl | 6.3 ms | 44× (33× to 49×) | 6.1 ms | 43× (36× to 51×) |
| the words written into the page | 0.04 ms | 0.29× (0.22× to 0.33×) | 0.04 ms | 0.28× (0.23× to 0.35×) |

Svelte renders one page of 2,000 message calls inside a request already open, as an app built with Vite renders it, its messages from each library built with its own plugins (`bench/ssr.mjs`). The clock is a warm render, `render(Page, { props })` after a warm-up; compiling, imports, the libraries' setup and the middleware are outside it. Each variant renders in a process of its own once a round, in an order that rotates; medians of the rounds with the interval that holds each, and each variant's ratio to grai's in the same round. The last row writes each message without a selector into the template. Paraglide 2.29.1, i18next 26.4.7, use-intl 4.14.9.
</details>
<!-- /charts:readme -->

[docs/benchmarks.md](docs/benchmarks.md) has every chart with how each was measured, and [docs/runtime.md](docs/runtime.md) the measurements behind grai's own decisions.

## Compared

| | grai | Paraglide JS | next-intl | i18next |
|---|---|---|---|---|
| Message syntax | MessageFormat 2 | inlang message format | ICU MessageFormat | i18next JSON, ICU through `i18next-icu` |
| Compiled ahead of time | yes | yes | no, read at run time | no, read at run time |
| A page's messages | the ones it calls, in its locale | the ones it calls, in every locale, or in its own with its per-locale build | for client components, the locale's catalog, or the messages the app picks | the namespaces the app loads |
| Typed | each message's inputs | each message's inputs | keys and arguments, with a declaration of the messages | keys, with `CustomTypeOptions` |
| Runtime a page needs to show a text, an input and a plural, brotli | <!-- value:runtime-grai -->1.4 KB<!-- /value --> | <!-- value:runtime-paraglide -->1.8 KB<!-- /value --> | <!-- value:runtime-use-intl -->10.2 KB<!-- /value -->, use-intl's | <!-- value:runtime-i18next -->12.2 KB<!-- /value --> |
| Frameworks | SvelteKit, Next.js, Nuxt, Astro, Vue, React, servers | any bundler, through its plugins | Next.js | React, Vue, Angular and others, through their packages |

Sources: each project's own documentation ([Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs), [next-intl](https://next-intl.dev/docs/getting-started), [i18next](https://www.i18next.com/overview/getting-started)), and for the sizes, `bench/library-bytes.mjs`.

## Limitations

Where the table at a glance has grai behind, clear of its interval:

<!-- behind -->
- **Editor: repeated completion, file unchanged, 13,326 keys:** 69 ms on grai against 5 ms on use-intl; 0.07× (0.04× to 0.09×), behind ([chart](docs/benchmarks.md#completing-a-key-in-the-editor)).
<!-- /behind -->

Besides those:

- **A cold check costs seconds on a large project,** the price of reading code exactly; CI's cache keeps it to the files that changed ([the commands' chart](docs/benchmarks.md#the-refactoring-commands)).
- **Not supported yet:** `:unit`'s `usage`, and an option's value taken from an input other than a currency, a unit and a time zone. Each is a compile error that names the construct, never an approximation.

[docs/limitations.md](docs/limitations.md) has the rest, each with its reason.

## Coming from Paraglide or i18next

Paraglide's catalogs compile unchanged, and its calls stay the same: `m.key(inputs, { locale })`. [docs/migrating-from-paraglide.md](docs/migrating-from-paraglide.md) gives the steps, the call sites grai refuses, and the few messages whose output differs.

From i18next, next-intl, react-intl or Lingui, `grai import --from i18next|icu <dir>` writes grai catalogs from theirs, and `grai migrate` rewrites each call that names its message plainly and lists every other call for a person: [docs/migrating.md](docs/migrating.md).

## Docs

- [Guide](docs/guide.md): catalogs, commands, a static site's locale, changing locale, tests and CI
- [Frameworks](docs/frameworks.md): Vite, Svelte, SvelteKit, Next.js, Astro, Vue, Nuxt and servers
- [Config](docs/config.md) and [API](docs/api.md)
- [Design](docs/design.md) and [Runtime](docs/runtime.md): the decisions, each with its reason and its numbers

## License

MIT
