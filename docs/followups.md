# Follow-ups

Open work that `docs/design.md` leaves to measurement or to a later change.

## grai/sveltekit names each page's entries

grai/vite chunks keys by the pages that load them when an adapter passes `pageEntries` (`docs/design.md`); without it each Kit node is a page of its own, 19 message chunks a page on app B against 13 with the pages. SvelteKit's adapter has to pass each route's leaf and layout nodes and the client entries.

Done when: grai/sveltekit's plugin passes them, and the SvelteKit example's build puts a key a layout and one of its pages use in the layout's chunk.

## Patch a server render whose Vite is another copy

The dev plugin patches a server environment's runner in place only when `isRunnableDevEnvironment` says it is one, which checks Vite's own class. A dev server made by another copy of Vite than the one grai imports, as in a workspace whose packages resolve Vite with different peers, fails that check: every edit then has the server take the messages again, about 110 ms on the synthetic catalog against 9 ms patched (`bench/hmr.mjs`, which now makes its server with grai's Vite for that reason). An app has one Vite, so this only shows in such setups.

Done when: a server environment that runs its modules in a runner is patched whichever copy of Vite made it, with a test that makes the server with another copy.

## Keys read through `m` passed whole, or named from keys.js, in a key's reach

A key's reach follows `m.key` and `m[name]` through the app's re-exports, a per-key path, and a module that only re-exports (`docs/design.md`). It does not follow `m` passed whole (`fn(m)`, `const t = m`) or a named import of a key from keys.js, so such a key is reached only from its other readers, and a page that reads it so loads its chunk as one more request.

Done when: the plugin's check follows each import a module binds that leads to keys.js, by its name, and a page-chunks test of each form chunks the key with the pages that read it.

## A page's later imports at its first paint

The merge rule may put a key a page needs only through a later import in a chunk that page's first paint loads, when another page's first paint needs the key: on app B four pages load one such key at first paint. Keeping a set that later imports load off the first paints it is not on, without knowing which pages make which later imports, cost the rule most of its merges: 46 chunks a page against 13. Telling it exactly needs each later import's pages, from its dynamic importers' reach.

Done when: a key reaches a page's first paint only if that page's first paint, not only a later import, needs it, with app B's chunks a page unchanged.

## A page's locale copies against Paraglide's per-locale build

On app A, a page's Russian copies take 1,017 KB brotli summed over its 73 pages, under Paraglide's per-locale build of each page's keys bundled into one file, 1,105 KB. On app B, with SvelteKit's pages, its Russian copies take 1,195 KB summed over its 89 pages, against 1,183 KB for Paraglide's tuned setup, though its English take 845 KB against 862. With every file's hashes made equal, the Russian is 1,176.5 against 1,173.5 KB. So 9 of the 12 KB gap as built is hash strings, which brotli cannot compress: each copy imports the runtime's chunk by a name that is all hash. The rest is the keys a page loads and does not name, as sets of entries share chunks, and each chunk compressing alone.

Done when: a page's locale copies take no more than Paraglide's per-locale build in `bytes`, on both apps.

## Nuxt dev under the Vite Environment API

With `experimental.viteEnvironmentApi`, Nuxt's one Vite server holds the browser's environment and the server's, and grai/vite, scoped to the browser's, still patches the server's environment in place after an edit, as if Vite's module runner ran it. Nuxt runs the server's modules in vite-node instead, so its next render keeps the old words.

Done when: grai/vite takes the messages again in an environment whose runner did not evaluate them, and a test of the Nuxt example under `experimental.viteEnvironmentApi` shows an edit in the server's next render.

## A Nuxt navigation's preloads

On a client navigation to a page Nuxt loads lazily, Vite's preload helper adds `modulepreload` links for the page's chunks as it imports them, and they name the shared message chunks, which no import map reaches. The browser then fetches both a shared chunk and the locale's copy.

Done when: a navigation preloads the locale's copies alone, with a test that it fetches no shared message chunk.

## Localized redirects in Nuxt

The url strategy's copy of a page keeps the page's `redirect`, so a redirect from a localized path leads to the base locale's path.

Done when: a copy's redirect to a path names its locale, with a test.

## Switch locale in place: `"switch": "live"`

No page switches in place yet, so the config refuses `"live"`, for which `grai/svelte` keeps every message a call. `docs/design.md` has the design: `setLocale(locale, { reload: false })` loads the target locale's message chunks, switches, and the app re-renders. Switching in place costs the target locale's chunks and one mount of the page, 2.3 ms for 2,000 messages (10.2 ms at a 4× CPU slowdown, `hydrate`); a reload costs a server render, the page's data and a hydration.

Done when: under `"live"`, a page re-renders in the locale it switches to, and a browser test shows that a production build and dev switch the same way.

## `setLocale(locale, { reload: false })` as its type says

`runtime.d.ts` types `setLocale` by the config's `switch`: `void` under `"reload"`, where `{ reload: false }` only keeps the choice for the next load, and `Promise<void>` under `"live"`, resolving once the locale's message chunks are in. Under `"live"` the runtime still only keeps the choice too, and returns nothing.

Done when: under `"live"`, it returns that promise (the entry above), with a browser test.

## Bound the formatters kept per value an input gives

`formatterFor` keeps an Intl formatter for each value an input gives an option, in a map that nothing empties. Intl takes any well-formed three-letter currency code, and any offset time zone such as `+05:31`. So a server that formats a currency or a zone a request names can be made to keep up to 17,576 currency formatters, or 2,879 zone formatters, for each such formatter and locale. An app's own data names a few dozen values: Intl knows 162 currencies and 418 time zones by name. A formatter's memory sits mostly outside V8's heap, in ICU, so the heap does not show it.

Done when: the map keeps a fixed number of values at most, dropping the oldest first. The number is chosen by measuring a formatter's resident memory and the cost of making one again, and a test shows that a value dropped and asked for again still formats.

## Function expressions on a server without Vite

The Vite plugin's server build writes each message function as a function expression, which V8 only pre-parses, and loads app A's messages in 24–25 ms against 30 ms with arrows (`startup`). `keys.js` still writes arrows, and a server that loads it without the Vite plugin, such as a Next.js server bundle or a plain Node server, pays the difference.

Done when: such a server loads function expressions while the browser keeps arrows, and `startup`'s row for the compiler's output shows the gain.

## Support the MessageFormat 2 constructs that are still compile errors

These are compile errors today:
- `:unit`'s `usage`, which converts the value into the locale's preferred units and which Intl cannot do.

Neither reference app uses them, but they are common in MessageFormat 2 catalogs, so other adopters will meet these errors first.

Done when: each compiles, with a test, and the design lists it among the constructs.

## Locals made from other locals

MessageFormat 2 lets a local be made from another, as in `local a = n: number` then `local b = a: integer`, and its functions compose: `b` takes `a`'s value and options, then its own. grai refuses such a local with an error naming both, and its message says to make it from the input instead.

`:offset` is one such function: its value keeps its operand's options, so `local o = n: offset subtract=1` after `local n = count: number select=ordinal` selects by the ordinal rules and shows the digits `n` shows. grai's `:offset` reads an input only, so it always selects by the cardinal rules and shows `:number`'s default, which is its own restriction, not MessageFormat 2's default.

Done when: a plural, formatted, `:offset` or `:string` local can be made from any other local, with the options composing as MessageFormat 2's functions do, its input typed and exported as the input it reads, and a test for each pairing.

## Read every source by scope in `grai check` (the owner's decision)

`grai check` reads sources as text, so where a file declares the namespace's name again, as `rows.map((m) => m.id)` does, it cannot tell which reads are grai's, and leaves that file's reads of the name out, saying so. A Vite build reads each module by scope through Vite's parser, but a project without Vite, such as a Next.js one, has only check. Depending on `oxc-parser`, the parser Vite 8 uses, would make check exact there too, for JavaScript, TypeScript and a component's scripts: its 0.155.0 is 2.9 MB unpacked, plus one native binding per platform (1.8 MB on macOS arm64, 2.1 MB on Linux x64, 1.6 MB on Windows x64, 1.7 MB as WebAssembly). It would be grai's first runtime dependency, which is the owner's to decide; templates would still be read as text. It would also make `rename` and check certain where the scan now refuses or leaves reads unchecked: JSX text, which the scan reads as JavaScript, and a `/` after `)` or `}`, which may start a regular expression or divide.

Done when: the owner has decided, and, if yes, check reads JavaScript, TypeScript and component scripts with the same scope reading as the build, with no file left unchecked for a redeclared name, and `rename` refuses no place the scan cannot read.

## Bind the locale in Next's server actions and route handlers

React keeps no `cache` in a server action or a route handler, so there a message names its locale (`docs/design.md`). A form's error messages are the common case.

Done when: a server action and a route handler render messages in the request's locale without naming it, with a test in the Next example.

## Vary Next's responses by the headers the strategy reads

With the `cookie` or `preferredLanguage` strategy, grai/next's proxy answers one URL in several locales, and a page Next renders ahead of time is sent as cacheable. A shared cache keyed by the URL alone then serves the first reader's locale to everyone. The proxy's rewrite lists the headers it read in `Vary`, as grai's middleware writes it, but Next writes its own `Vary` for its RSC requests, and whether the page's response keeps the proxy's is not measured.

Done when: a page served through a shared cache renders in each reader's locale under those strategies, with a test.

## Ship one locale's client messages on Next.js

A client component's messages ship with every locale's variants: one Next build serves every locale, and Next gives an adapter no way to point a page at one locale's chunks. On the bench's page, grai costs 7.3 KB brotli more than the same page with its words written in, for 100 client messages in three locales and the runtime (`docs/runtime.md`).

Done when: a Next page's client chunks hold only its locale's variants, with a browser test that it loads no other locale's words.

## Make Next's first compile of a page cheaper

On the bench's page, `next dev`'s first response from an empty `.next` still takes longer with grai than with next-intl (`docs/runtime.md`). What costs is compiling the shards, not calling them. Turbopack's CPU until that response, medians of 7 with the alias written by hand, at a load of 17–18: the page with its words written in and no messages, 3,910 ms; with its 500 messages, 5,250 ms, and with each component calling one message and its others written in, 5,240, as Turbopack compiles all 16 shards, 1.4 MB, in each of the three layers that import keys.js. next-intl's whole page takes 4,220 ms, its catalog being JSON.

Measured and not taken, as each wins on one count and loses on another:
- **A module per key**, which Turbopack follows from `m.title` to the key's module once a package.json in the outdir says no module but server.js has side effects. Each layer then compiles only the keys it names, but Turbopack spends about 2.5 ms of CPU on each module, one plain function's included, so on the synthetic catalog the page's 600 modules cost what the shards did (1,521 ms against 1,624), while on app B's, twice the keys, they took 1,552 ms against 2,018, next-intl's being 1,452. It writes a file per key, 6,366 more for the synthetic catalog and 0.75 s more on a first compile, Node and a test runner without grai's plugin load keys.js in 785 ms against 45, and `import { m }` reaches every key's module: 7.6 s to the first response.
- **A shard binding each function its keys call once** (`const text = $text`). Turbopack writes about 130 characters for each reference to an import, so the shards' code in `next dev` drops by 40%, and the CPU to the first response by 300–440 ms on the synthetic catalog and 840 ms on app B's. But Turbopack then puts two shards in a chunk, and an edit to a server component's message showed 20–70 ms later in two windows of three.
- **A shard's text keys as one JSON table, made into messages by a loop,** as the Vite dev module has them: 5,060 ms against 5,230.
- **The output under `node_modules`**, which Turbopack builds more cheaply: 1,827 ms against 2,039 in one window, next-intl's being 1,610.
- Tried, and no better: one keys module, 64 shards, and Turbopack's module fragments (`experimental.turbopackModuleFragments`), 18.5 s.

Done when: a change brings the first compile level with next-intl's, or the design records why it stays.

## `import { m }` in `next dev`

`next dev` builds `m`, the namespace messages.js re-exports, whole in each layer that imports it, and again after each edit, so the README has Next's modules import the namespace of keys.js, which Turbopack reads member by member (`docs/design.md`). Turbopack tracks a member read through a re-exported namespace when it builds for production ([vercel/next.js#96396](https://github.com/vercel/next.js/pull/96396)), but `next dev` 16.4.3 and 16.5.0-canary.27 still compile the namespace's module whole: with four modules behind it and a page reading one, all four are compiled through `import { m }`, one through `import * as m`. Meanwhile `grai migrate` writes the namespace import in a Next app, and `import { m }` everywhere else.

Done when: `next dev` reads `m.key` through `export * as m` as it reads `import * as m`, with the bench's edits through `import { m }` as fast as through the namespace.

## Next on a loopback address

Next 16.4 started on `127.0.0.1` or `[::1]` (`--hostname`, or `HOSTNAME` behind a reverse proxy) takes every proxy rewrite for an external one. Next's `NextURL` renames a loopback host `localhost`, so the rewrite the proxy returns names `localhost`, while Next's router knows itself by the address it was started on. It proxies the request to itself, where grai/next's proxy rewrites it again, under another `/<locale>`, and the page never answers. A Next app without grai, whose proxy only rewrites `/` to `/en`, answers, but runs its proxy twice for the page. Once its proxy rewrites every path, as an unprefixed base locale's does, it never answers either: 259 runs of the proxy in 10 s. On Next's default host, `0.0.0.0`, `localhost` and the machine's address, the rewrites stay internal. It is Next's bug, reported as [vercel/next.js#94745](https://github.com/vercel/next.js/issues/94745), with a fix in review, [vercel/next.js#95917](https://github.com/vercel/next.js/pull/95917): `NextURL` and the router name a loopback host differently. grai does not work around it.

Done when: a Next release keeps a loopback host's rewrites internal, and grai/next's `next` peer range starts at it, with a test that serves the example on `127.0.0.1`.

## Report markup elements the base locale does not have

`Markup` throws for an element the app does not draw, and the app draws the base locale's. A translation that adds an element then throws in that locale only.

Done when: the compile, or `grai check`, reports a markup element that a locale names and the base locale does not.

## Prove the design on both reference apps

App A runs on grai, and the README cites its numbers. On the client, a forced `{ locale }` other than the current one throws, and every key must be in every locale; app B is not known to break either rule outside its tests.

Done when: a local branch of app B on grai passes its own checks and tests, and the README cites its cold `dev` and one-message edit times.

## Import what `grai import` leaves out

vue-i18n's own syntax, with `|` plurals and `@:` links, is not ICU, and nothing reads it. ICU's skeleton stems and date fields that Intl has no option for (`scale`, `integer-width`, weeks, quarters) are left out, as no import can express them.

Done when: each converts, `bench/import-equivalence.mjs` covers it, and the design lists it.

## Import ICU names that are not JavaScript identifiers

`grai import` leaves out an ICU message whose argument is named `{0}` or `{имя}`, which intl-messageformat takes, since a grai input is a JavaScript identifier.

Done when: such an argument imports under an identifier, `grai.import.json` maps the source's name to it for `grai migrate`, and the import fuzz generates such names.

## Import an ICU ordinal's offset

`grai import` leaves out `{n, selectordinal, offset:1 …}`, which chooses by the ordinal category of the count less the offset.

Done when: it converts, a test checks it against intl-messageformat, and the import fuzz's ordinals with offsets render the same.

## Import i18next's formats a project adds, and `$t()` with options

`grai import` leaves out a format i18next does not build in, such as `{{value, uppercase}}`, which a project adds or i18next shows unformatted, and `$t(key, { … })` or `$t(key, format)`, which passes options or a format to the nested message.

Done when: the import can map a project's format to a grai function, `$t()` with options nests the message with those inputs, and `bench/import-equivalence.mjs` covers both.

## Rename what a module reads off a dynamic import

`grai rename` refuses `(await import("…/messages/key.js")).key` and `module.key` after `const module = await import(…)`, since the scan does not follow a value. Both are rare outside tests.

Done when: a rename changes them, with a test of each.

## Descriptors `defineMessages` names, in `grai migrate`

react-intl apps often write their descriptors once, `const messages = defineMessages({ title: { id: "shop.title", defaultMessage: "Shop" } })`, and call `intl.formatMessage(messages.title)` or `<FormattedMessage {...messages.title} />`. `grai migrate` lists those calls, although a `const` that `defineMessages` initializes with the ids written in it names each message as plainly as a descriptor written in the call.

Done when: `grai migrate` rewrites both calls of such a `const` in the module that declares it, and removes the `const` once nothing reads it.

## The messages a `<Trans>` renders, as grai markup

A `<Trans>`'s message reads its tags as elements: `Hello <1>{{name}}</1>` numbers one by the `<Trans>`'s children, and `<bold>` names one of its `components`, each taking the attributes the translation gives it, while `<strong>` or `<br/>` may be a basic HTML node it keeps. `grai import` keeps every tag as text, which is right for a `t()` call, and `grai migrate` lists the `<Trans>` for a person to write its message's tags as grai markup in each catalog. Only the call sites tell which keys are rich text: reading every string with angle brackets as markup would break a `t()` message that shows them.

Done when: `grai migrate` writes the messages of each key a `<Trans>` renders, in every locale and variant, as grai markup, with its numbered, named, basic and self-closing tags and their attributes, under names the markup component of the next entry can render; it leaves every other key's text as it is and lists a tag it cannot name, with why; and a test covers each kind of tag.

## Calls that render markup, in `grai migrate`

`<Trans>`, next-intl's `t.rich` and `t.markup`, and a react-intl message with markup are listed for a person, who renders the message's `.parts()`. A framework's markup component, such as `grai/react`'s `Markup`, would take the tags' renderers the call passes.

Done when: `grai migrate` rewrites a call whose tags each render one element of the call's own as that component's call, and a test renders it as the library did.

## A component's script, in `grai migrate`

`grai migrate` lists each Svelte, Vue, Astro or MDX component that imports the library, and rewrites none: its markup calls messages too, outside what an ES module parser reads.

Done when: `grai migrate` rewrites the calls in a component's script, and lists each one its markup makes.

## Keep the locale through Astro's client router

Under Astro's `<ClientRouter />`, a link into another locale swaps the page in place. The runtime read `<html lang>` when the page first loaded, and the import map, once read, cannot change, so the new page's islands render in the first page's locale. Until this is done, a link into another locale needs `data-astro-reload`.

Done when: a client-router navigation into another locale loads the page anew, with a browser test in the Astro example.

## Server islands and actions in the page's locale

A server island (`server:defer`) and an Astro action are requests of their own, to paths without the page's locale prefix. Under the `url` strategy they render in the base locale; the `cookie` and `preferredLanguage` strategies find the reader's.

Done when: a server island and an action on a page under `/ro/` render in `ro` under the `url` strategy, with a test in the Astro example.

## The import map under a CSP of hashes

`handleLocale` gives the import map Kit's nonce, but no hash. Under a `csp` in `hash` mode, and on a prerendered page in `auto` mode, the browser refuses the map: the page then imports the shared message chunks, and its preloads still fetch the locale's copies, so it downloads both.

Done when: the map's hash joins the page's `script-src`, in the `Content-Security-Policy` header and in a prerendered page's `<meta http-equiv>`, with a test of the example in `hash` mode that downloads only the locale's copies.

## A dev edit while a SvelteKit page is still starting

`grai/sveltekit/client` runs a page's loads again with Kit's `refreshAll()` once the server has an edit (`grai:patched`). Kit drops a `refreshAll()` called before its client has started, as it reads the page's URL from state the start sets, so an edit that lands while the page is still starting shows only after the next edit, or a navigation. The server-rendered page is already on screen by then, so the window is the page's own start.

Done when: `grai/sveltekit/client` defers that refresh until Kit has started, with a test of the example that edits a load's text as soon as the page's markup is on screen and sees the edit.

## The locale script outside Vite's pages

Only a page that goes through Vite's HTML pipeline gets the locale script. A page another bundler or framework draws, such as Next's static export or a prerendered SvelteKit page, has none, so where no server picks its locale it renders in the one it was drawn in.

Done when: each adapter that can draw a page no server serves writes the script into it, from `locale-script.ts`, with a browser test of a static build in each.

## An app's own import map beside the locale script's

The locale script writes the page's import map. A page that has one of its own then has two, which only browsers that merge import maps read both of; another takes the first and refuses the second.

Done when: the plugin merges the page's own import map into the one the locale script writes, with a browser test of a page that has one.

## A text that holds the bundler's placeholder for a hash

A Vite build refuses a text with `!~{…}~` in it (`placeholderTexts` in `src/vite-build.ts`). Rolldown writes each chunk's hash over its placeholder wherever that is in a chunk's code, a string's value included, and grai does the same in each locale's copy. Every other way of writing the text, such as `\x7e` for the `~`, an escaped template, a concatenation or a join, comes out of Rolldown's printer and minifier as the one string again before the hashes go in.

Done when: Rolldown leaves the placeholder's shape in a string's value alone, and the build takes the text as it is.

## A load by a path the scan cannot read

`check --fix` keeps the keys a dynamic import or a Vite glob may load when its path starts with literal text that names the messages directory, `` import(`#i18n/messages/${key}.js`) ``, and `rename` refuses such a load. A load whose path is a variable, `import(path)`, may load any module, a per-key one among them, but taking each for one would keep every unused key, and refuse every rename, in an app that loads any module by a variable: app B has 15 such loads, of its own modules. So such a load counts for none; one of a per-key module whose path the app builds elsewhere would lose its keys to `check --fix`.

Done when: the owner has decided between reading such loads as reaching every key, with a way to say which do not, and following the path to where it is built.
