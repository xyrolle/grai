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

Each row is a measure where lower is better: grai's figure, the best figure of the others measured beside it, and the ratio of theirs to grai's. The strongest come first; the rows where grai is behind are there too. Each measure links to its chart, and the [Performance](#performance) section says how they were run.

<!-- glance -->
| Measure | grai | Best of the others | Ratio |
| --- | --- | --- | --- |
| [Compile after one edit, 13,326 keys](docs/benchmarks.md#compiling-after-one-edit) | 12 ms | 6.32 s (Paraglide) | 531× |
| [Full compile, 13,326 keys, both typed](#compiling-the-catalogs) | 147 ms | 13.2 s (Paraglide, with declarations) | 90× |
| [Full compile, 13,326 keys, Paraglide untyped](#compiling-the-catalogs) | 147 ms | 6.32 s (Paraglide) | 43× |
| [Ordinal form chosen, `ru`](docs/benchmarks.md#choosing-an-ordinal) | 4.4 ns | 141 ns (Intl.PluralRules, cached) | 32× |
| [Editor: first key completion, 13,326 keys](docs/benchmarks.md#completing-a-key-in-the-editor) | 231 ms | 3.23 s (Paraglide) | 14× |
| [Plural form chosen, `ru`](docs/benchmarks.md#choosing-a-plural) | 15 ns | 206 ns (Intl.PluralRules, cached) | 14× |
| [Time i18n adds to a build, 13,326 keys](#a-production-build) | 0.92 s | 8.40 s (Paraglide) | 9.1× |
| [`tsc` on 500 calls, 13,326 keys](docs/benchmarks.md#completing-a-key-in-the-editor) | 97 ms | 709 ms (Paraglide) | 7.3× |
| [Runtime in a page, brotli](docs/benchmarks.md#the-runtime) | 0.6 KB | 3.6 KB (Paraglide) | 5.8× |
| [Vite dev: an edit, until shown](#an-edit-in-development) | 15 ms | 72 ms (use-intl) | 4.7× |
| [Server: a message call, a page's mix](#a-message-call-on-a-server) | 57 ns | 126 ns (Paraglide) | 2.2× |
| [Next.js dev: an edit in a client component, until shown](docs/benchmarks.md#nextjs-an-edit-in-development) | 73 ms | 150 ms (next-intl) | 2.1× |
| [Page JS, 2,000 messages, brotli](#what-a-page-downloads) | 22.6 KB | 36.7 KB (Paraglide) | 1.6× |
| [Server render, 2,000 messages](#a-server-render) | 0.21 ms | 0.32 ms (Paraglide) | 1.5× |
| [Hydration, 2,000 messages](docs/benchmarks.md#hydrating-a-page) | 5.9 ms | 8.7 ms (Paraglide) | 1.5× |
| [Next.js dev: an edit in a server component, until shown](docs/benchmarks.md#nextjs-an-edit-in-development) | 142 ms | 146 ms (next-intl) | 1.0× |
| [Next.js dev: a cold start's first page](#nextjs-a-cold-dev-servers-first-page) | 1.41 s | 1.20 s (next-intl) | 0.85×, behind |
| [Vite dev: a cold start, until shown](docs/benchmarks.md#starting-the-dev-server) | 297 ms | 201 ms (i18next) | 0.68×, behind |
| [Editor: next key completion, 13,326 keys](docs/benchmarks.md#completing-a-key-in-the-editor) | 64 ms | 5 ms (use-intl) | 0.08×, behind |
<!-- /glance -->

## Why grai

- **A page ships only the messages it calls.** The build splits the catalog by key and by locale: a page of 2,000 messages downloads <!-- value:page-grai -->22.6 KB<!-- /value --> of JavaScript, against <!-- value:page-paraglide -->36.7 KB<!-- /value --> on Paraglide and <!-- value:page-i18next -->129.2 KB<!-- /value --> on i18next.
- **A runtime of <!-- value:runtime-grai -->0.6 KB<!-- /value -->,** its whole API, brotli: Paraglide's is <!-- value:runtime-paraglide -->3.6 KB<!-- /value -->, use-intl's <!-- value:runtime-use-intl -->10.2 KB<!-- /value --> and i18next's <!-- value:runtime-i18next -->12.1 KB<!-- /value -->.
- **Typed MessageFormat 2,** the Unicode standard: plurals, selects, number, date and list formatting, and markup. A message is a function typed by its inputs, so a missing or mistyped input is an error where it is called, and a plural takes <!-- value:plural-grai -->64 ns<!-- /value --> on a server, against <!-- value:plural-paraglide -->885 ns<!-- /value --> on Paraglide.
- **Refactoring that reads code as the bundler does.** `grai check`, `check --fix`, `find`, `rename` and `migrate` parse each file and follow its imports, so a key a comment mentions is no read, and `check --fix` never removes a key a page calls. A check of a 13,000-key, 9,000-file project takes <!-- value:check-warm -->0.50 s<!-- /value --> once its facts are kept.
- **Edits in place.** An edited message shows in the open page in <!-- value:dev-grai -->15 ms<!-- /value -->, without a reload; on Paraglide, its plugin compiles again and the edit takes <!-- value:dev-paraglide -->3.07 s<!-- /value -->.
- **Adapters for six frameworks:** SvelteKit, Next.js, Nuxt, Astro, Vue and React, a Vite plugin for any other app, and a middleware for Workers, Bun, Deno and Node.

## Quick start

```sh
pnpm add -D grai
```

Its commands and plugins need Node 22.18 or later. The output's `server.js` imports `node:async_hooks`, so a project whose type checker reads the output's JavaScript, as a SvelteKit app's reads all of `src`, needs Node's types too: `pnpm add -D @types/node`.

Catalogs are the inlang message format, one JSON file per locale, as Paraglide reads them, and `grai.config.json` names them:

```json
{
  "$schema": "./node_modules/grai/config.schema.json",
  "locales": ["en", "ro"],
  "baseLocale": "en",
  "catalogs": "messages/{locale}.json",
  "outdir": "src/lib/i18n"
}
```

Then add grai to the app:

| Framework | What to add | Docs |
|---|---|---|
| SvelteKit | `grai()` from `grai/sveltekit/vite` before `sveltekit()`, and `handleLocale` in `hooks.server.ts` | [SvelteKit](docs/frameworks.md#sveltekit) |
| Next.js | `withGrai(config)` from `grai/next/config`, the proxy from `grai/next/proxy`, and `bindLocale` in each layout and page | [Next.js](docs/frameworks.md#nextjs) |
| Nuxt | `modules: ["grai/nuxt"]` | [Nuxt](docs/frameworks.md#nuxt) |
| Astro | `integrations: [grai()]` from `grai/astro` | [Astro](docs/frameworks.md#astro) |
| Vue | `grai()` from `grai/vite`, and `Markup` from `grai/vue` | [Vue](docs/frameworks.md#vue) |
| React | `Markup` from `grai/react`, beside Next.js or Vite | [Next.js](docs/frameworks.md#nextjs) |
| Any Vite app | `plugins: [grai()]` from `grai/vite` | [Vite](docs/frameworks.md#vite) |
| Workers, Bun, Deno and Node | `middleware` from the output's `server.js` | [Servers](docs/frameworks.md#workers-bun-deno-and-node) |

`grai compile` writes the output, and `grai watch` writes it again on each edit; each adapter does both for you. The [guide](docs/guide.md) covers the commands, a static site's locale, tests and CI, and [docs/config.md](docs/config.md) every field of the config.

## Performance

Every number here comes from a bench in [`bench/`](bench), run in one window on <!-- value:bench-date -->27 Oct 2026<!-- /value --> on <!-- value:bench-machine -->an Apple M5 Pro with 18 cores<!-- /value -->, beside other work: its one-minute load was <!-- value:bench-load -->7 to 23<!-- /value --> through the window.<!-- value:bench-after --> The dev server's cold start (15:08 UTC, its load from 16 to 32) and the compile times (15:14 UTC, its load from 32 to 11) were measured on their own afterwards, on the same code.<!-- /value --> The catalog is `bench/synthetic.mjs`'s, 6,366 keys in three locales with a production app's shares of plurals, inputs and markup, and the same shares at 13,326 keys where a chart groups by size, so anyone can run them. `bench/results/` holds what each run recorded, with its versions and load, and `node scripts/charts.ts` draws the charts and the table above from it.

<!-- charts:readme -->
### Compiling the catalogs

grai's output is typed: it writes each message's declarations as it compiles. Paraglide writes its own only when asked, through TypeScript's compiler, so it is measured both ways.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/compile-dark.svg">
  <img alt="Compiling the catalogs: 6,366 keys, grai 124 ms, Paraglide 4.45 s and Paraglide, with declarations 9.49 s; 13,326 keys, grai 147 ms, Paraglide 6.32 s and Paraglide, with declarations 13.2 s." src="docs/assets/compile-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | keys | full compile | nothing changed | one message edited |
| --- | --- | --- | --- | --- |
| grai | 6,366 | 124 ms | 2 ms | 11 ms |
| Paraglide, message modules, without declarations | 6,366 | 4.45 s | the same | the same |
| Paraglide, message modules, with declarations | 6,366 | 9.49 s | the same | the same |
| Paraglide, locale modules, with declarations | 6,366 | 55.6 s | the same | the same |
| grai | 13,326 | 147 ms | 2 ms | 12 ms |
| Paraglide, message modules, without declarations | 13,326 | 6.32 s | the same | the same |
| Paraglide, message modules, with declarations | 13,326 | 13.2 s | the same | the same |
| Paraglide, locale modules, with declarations | 13,326 | 225.5 s | the same | the same |

Each compile in a new Node process, timed once its modules have loaded, from no output (`bench/compile-time.mjs`). grai's times are medians of 3, and so are Paraglide 2.29.1's in its message-module layout, without declarations and with them, which go through TypeScript 6. Its locale-module layout with declarations, minutes a compile, is one run each. Paraglide compiles everything again on any change.
</details>

### A production build

What i18n adds to an app's production build, against the same app with every message written in.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/build-added-dark.svg">
  <img alt="Time i18n adds to a production build: 6,366 keys, grai 0.45 s and Paraglide 4.22 s; 13,326 keys, grai 0.92 s and Paraglide 8.40 s." src="docs/assets/build-added-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | keys | added | its compile | the rest | hooks Rolldown names |
| --- | --- | --- | --- | --- | --- |
| grai | 6,366 | 0.45 s | 0.11 s | 0.34 s | none of 1 s or more |
| Paraglide | 6,366 | 4.22 s | 4.05 s | 0.16 s | buildStart 4.00 s |
| grai | 13,326 | 0.92 s | 0.20 s | 0.73 s | none of 1 s or more |
| Paraglide | 13,326 | 8.40 s | 7.95 s | 0.46 s | buildStart 8.00 s |

Vite 8.3.5 (Rolldown 1.2.15) builds one app of 64 pages that call every key of the synthetic catalog, on grai, on Paraglide 2.29.1 and with the words written in, each build from a clean checkout in a new process, the three taking turns, medians of 5 (`bench/build-added.mjs`). Added is the build less the build without i18n. Its compile is the library's own, catalogs to output, timed alone, which both plugins run in `buildStart`; the rest is the plugin's other work and Rolldown's on the message modules. Rolldown times the plugins' hooks itself, and names a hook of a second or more; the table gives those of the median build.
</details>

### An edit in development

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/dev-edit-dark.svg">
  <img alt="One message edited, until the page shows it: grai 15 ms, use-intl 72 ms, i18next 74 ms and Paraglide 3.07 s." src="docs/assets/dev-edit-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | edit to page, ms |
| --- | --- |
| grai | 15.2 |
| Paraglide | 3,073.5 |
| i18next | 74.3 |
| use-intl | 71.7 |

A catalog saved until Chromium 156.0.8078.4 shows the edit, medians of 20 edits (`bench/hmr.mjs`). grai patches the open page in place; Paraglide's plugin compiles again, and i18next and use-intl send the locale's catalog again.
</details>

### A message call on a server

In a page's mix of 2,000 calls, grai takes 57 ns a call against Paraglide's 126 ns. Measured kind by kind in `ro` and `ru`: grai is ahead in each on plain text, messages with inputs and plurals. On markup, the lead changes hands from one locale to the other. Given each call's locale, Paraglide is ahead in each on plain text and markup.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/server-page-dark.svg">
  <img alt="A page's 2,000 message calls on a server: grai 57 ns, Paraglide 126 ns, i18next 2,584 ns and use-intl 4,627 ns." src="docs/assets/server-page-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | locale | page's mix | text | inputs | plural | markup |
| --- | --- | --- | --- | --- | --- | --- |
| grai | ro | 66 | 34 | 42 | 61 | 160 |
| Paraglide | ro | 373 | 116 | 96 | 1,075 | 114 |
| i18next | ro | 2,612 | 2,026 | 2,778 | 4,570 | — |
| use-intl | ro | 4,978 | 4,583 | 4,809 | 6,507 | 3,911 |
| grai, given `{ locale }` | ro | 36 | 26 | 40 | 44 | 159 |
| Paraglide, given `{ locale }` | ro | 179 | 22 | 35 | 1,061 | 98 |
| grai | ru | 57 | 38 | 78 | 64 | 137 |
| Paraglide | ru | 126 | 151 | 283 | 885 | 156 |
| i18next | ru | 2,584 | 2,162 | 3,000 | 4,617 | — |
| use-intl | ru | 4,627 | 3,892 | 4,903 | 6,835 | 4,100 |
| grai, given `{ locale }` | ru | 33 | 29 | 91 | 51 | 136 |
| Paraglide, given `{ locale }` | ru | 152 | 20 | 96 | 794 | 126 |

Nanoseconds a call in Node, inside a request, on the synthetic catalog (`bench/server.mjs`). The page's mix is 1,318 text, 493 inputs, 104 plural and 85 markup calls, each made as an app makes it, a message with markup called for its text; the markup column draws its parts, which i18next has none of. Paraglide 2.29.1, i18next 26.4.7, use-intl 4.14.9.
</details>

### What a page downloads

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/page-js-dark.svg">
  <img alt="A page of 2,000 messages: its JS: grai 22.6 KB, Paraglide 36.7 KB, use-intl 127.1 KB and i18next 129.2 KB." src="docs/assets/page-js-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | JS, KB brotli | JS, KB |
| --- | --- | --- |
| grai | 22.6 | 96 |
| Paraglide | 36.7 | 172 |
| i18next | 129.2 | 682 |
| use-intl | 127.1 | 682 |

One Svelte page, server-rendered and hydrated in Chromium, in `ru` (`bench/hydrate.mjs`). grai's row loads its locale's copies of the message chunks, as `grai/sveltekit` serves them.
</details>

### A server render

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/ssr-dark.svg">
  <img alt="A server render of a page of 2,000 messages: grai 0.21 ms, Paraglide 0.32 ms, i18next 5.0 ms and use-intl 7.4 ms." src="docs/assets/ssr-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | ro, ms | ru, ms |
| --- | --- | --- |
| grai | 0.19 ms | 0.21 ms |
| Paraglide | 0.28 ms | 0.32 ms |
| i18next | 4.7 ms | 5.0 ms |
| use-intl | 7.3 ms | 7.4 ms |
| the words written into the page | 0.05 ms | 0.06 ms |

Svelte renders one page of 2,000 message calls inside a request, its messages from each library (`bench/ssr.mjs`); the last row has the words written into the page, the floor of a render with no message calls. Paraglide 2.29.1, i18next 26.4.7, use-intl 4.14.9.
</details>

### Next.js: a cold dev server's first page

grai is behind here: in rounds the two apps took in turn, its first page came in a median of 1,415 ms against next-intl's 1,200 ms, the rounds ranging over 1,339–1,450 and 1,129–1,237 ms. Turbopack compiles grai's message functions in each layer that imports them, where next-intl's catalog is data. A built Next.js page is smaller on grai ([docs/runtime.md](docs/runtime.md#nextjs)).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/next-first-page-dark.svg">
  <img alt="Next.js: the first page of a cold next dev: next-intl 1.20 s and grai 1.41 s. grai is behind here." src="docs/assets/next-first-page-light.svg" width="480">
</picture>

<details>
<summary>The numbers</summary>

|  | ready, ms | first page, ms | page download, KB brotli |
| --- | --- | --- | --- |
| grai | 218 | 1,415 | 129.0 |
| next-intl | 221 | 1,200 | 230.9 |
| next-intl, client keys picked | — | — | 134.8 |

Next 16.4.3 with Turbopack, next-intl 4.14.9, a page of 400 messages in a server component and 100 in a client one, in `ru`; the apps take turns, medians of 7 (`bench/nextjs.mjs`). The last row picks the client component's keys, as next-intl's docs advise; only its download was measured.
</details>
<!-- /charts:readme -->

[docs/benchmarks.md](docs/benchmarks.md) has every chart with how each was measured, and [docs/runtime.md](docs/runtime.md) more rows.

## Compared

| | grai | Paraglide JS | next-intl | i18next |
|---|---|---|---|---|
| Message syntax | MessageFormat 2 | inlang message format | ICU MessageFormat | i18next JSON, ICU through `i18next-icu` |
| Compiled ahead of time | yes | yes | no, read at run time | no, read at run time |
| A page's messages | the ones it calls, in its locale | the ones it calls, in every locale, or in its own with its per-locale build | for client components, the locale's catalog, or the messages the app picks | the namespaces the app loads |
| Typed | each message's inputs | each message's inputs | keys and arguments, with a declaration of the messages | keys, with `CustomTypeOptions` |
| Runtime in a page, brotli | <!-- value:runtime-grai -->0.6 KB<!-- /value --> | <!-- value:runtime-paraglide -->3.6 KB<!-- /value --> | <!-- value:runtime-use-intl -->10.2 KB<!-- /value -->, use-intl's core | <!-- value:runtime-i18next -->12.1 KB<!-- /value --> |
| Frameworks | SvelteKit, Next.js, Nuxt, Astro, Vue, React, servers | any bundler, through its plugins | Next.js | React, Vue, Angular and others, through their packages |

Sources: each project's own documentation ([Paraglide JS](https://inlang.com/m/gerre34r/library-inlang-paraglideJs), [next-intl](https://next-intl.dev/docs/getting-started), [i18next](https://www.i18next.com/overview/getting-started)), and for the sizes, `bench/library-bytes.mjs`.

## Limitations

- **Next.js development reaches its first page no sooner** than next-intl's, as above.
- **A cold Vite dev server shows its first page later** than one serving i18next's or use-intl's catalog, which nothing compiles: grai compiles the catalogs as the server starts. On 6,366 keys that is <!-- value:start-grai -->297 ms<!-- /value --> against <!-- value:start-best -->201 ms on i18next<!-- /value --> ([the chart](docs/benchmarks.md#starting-the-dev-server)).
- **A new server process loads the messages more slowly** than i18next or use-intl, though it renders its first page sooner, and with Node's compile cache loads first ([docs/limitations.md](docs/limitations.md)).
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
