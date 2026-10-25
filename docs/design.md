# Design

grai compiles translation catalogs into plain functions and their type declarations. These are the decisions, each with its reason.

## Goals

The reference workloads are two production SvelteKit apps: app A with 6,379 keys × 3 locales (about 19k messages), and app B with 13,326 keys × 3 locales (about 40k messages).
- A full compile takes well under a second on either.
- An edit to one message reaches the output in milliseconds.
- No network, no plugins, and no TypeScript run.
- The browser gets only its own locale's words.

## Catalogs and config

- **Catalogs are the inlang message-format JSON, one file per locale,** so existing Paraglide catalogs compile unchanged. `$schema` is ignored.
- **An object of messages nests keys.** A message's key is the names of the objects it is in and its own, joined by `_`: `{ "cart": { "title": … } }` holds `cart_title`. That's how `grai import` names a nested source key, and how Paraglide exports one, so the call is `m.cart_title()` either way. As in the format, a message is a string or an array, and any other object holds messages.
  - Two paths that name one key (`cart.title` and `cart_title`) are an error in their catalog, and so is a message with variants written without its array.
  - The joined key must be a key name like any other, so `cart.item-count` is an error naming its path.
- **The constructs are a deliberate subset:**
  - text and `{name}` placeholders;
  - markup: `{#tag}…{/tag}` and `{#tag/}`, with options (`href=|/terms|`, `rel=$rel`) and attributes (`@translate=no`, `@hidden`), a quoted value holding any text, braces too, with `\` escaping the next character;
  - variants: `declarations` (`input x`, `local y = x: plural`, `local y = x: plural type=ordinal`, and a `:number` or `:integer` local to select on), `selectors` and `match`, with `*`, several selectors, and `""` for a message without selectors;
  - formatting: `:string`, `:number`, `:integer`, `:percent`, `:currency`, `:unit`, `:relativetime`, `:list`, `:datetime`, `:date` and `:time` with their options, in a placeholder (`{x :number}`) or as a local (`local y = x: number`). `useGrouping` takes Intl's `always`, `auto` and `min2`, and `true` and `false` as Paraglide writes them, which Intl takes as booleans and not as their text; MessageFormat 2's `never` is `false`;
  - the escapes `\{`, `\}` and `\\`.

  Anything else is a compile error that names the construct, rather than an approximation. That covers functions grai does not have, such as a project's own, an option's value taken from an input other than a currency, a unit or a time zone (such as `style=$style`), plural options other than `type`, a local made from another local, and selecting on a date, or on a number whose notation or style shows more than its digits (`docs/followups.md`). So is a message whose program would not mean what it says: a name declared twice, which MessageFormat 2 also refuses, and a selector that is no name or is listed twice.
- **A key is a JavaScript identifier, unique ignoring case.** It is the export name, and the last segment of its per-key import path. On a case-insensitive file system, two such paths that differ only in case are one file.
- **Every key is in every locale.** A key missing from a locale is one compile error naming the locales that lack it and the `grai add` command that adds it to them. A missing translation would otherwise ship as a failed import or as another locale's words.
  - **A locale can fall back to another of its language,** with `"fallbacks": { "en-GB": "en" }`: a key its catalog lacks then compiles from the other's message, which costs nothing at run time, and its catalog can hold only the messages that differ, or none. Never to another language, as i18next allows, which would show that language's words, and never by tag alone, as Paraglide does, so a locale stays strict unless the config says otherwise. The base locale takes no fallback, as its catalog is where every key is declared.
- **The config is one JSON file, `grai.config.json`:** `locales`, `baseLocale`, `catalogs` (`"messages/{locale}.json"`), `outdir`, the server's `strategy` and its cookie's `cookieName`, `cookieMaxAge`, `cookieDomain` and `cookieSameSite`, `switch`, `tests`, `identicalToBase` and `fallbacks`. JSON is read without executing code, so the CLI, Vite and Next read the same file the same way.
  - **Editors complete and check it through `config.schema.json`,** which the package ships and a config names with `"$schema": "./node_modules/grai/config.schema.json"`.
- **A pseudo-locale is compiled for development, and never for a build.** `pseudoLocale` names a locale, such as `en-XA`, made from the base's messages at compile time:
  - each letter is accented, the text grows by about 35% in whole words, and each message is in brackets, its placeholders and markup as the base writes them;
  - a page in it shows which text bypasses the catalogs, which layout breaks with longer words, and where a text is cut, with no translator involved;
  - it takes the base's variants, so it must have the base's plural categories;
  - `grai watch` and the Vite dev server compile it. `grai compile` and a Vite build leave it out, so it never ships, even when a build runs over a dev server's output.
- **Nothing is fetched and nothing is loaded from elsewhere.** grai's parser is the format's only reader, so a compile cannot depend on the network.

## Output layout

```
<outdir>/
  messages.js   messages.d.ts    `m`, the namespace of keys.js
  keys.js       keys.d.ts        every message, as the re-exports of the shards
  runtime.js    runtime.d.ts     the runtime apps import: a re-export of runtime-<hash>.js
  server.js     server.d.ts      the request middleware; client code never imports it
  config.js                      the project's locales and strategy: a re-export of config-<hash>.js

  keys/<n>-<hash>.js  .d.ts      a shard: about 512 keys
  keys/<n>.d.ts.map              its declarations' map to the keys in the base catalog
  runtime-<hash>.js   .d.ts      the runtime, the same for every project, but for its config's name
  config-<hash>.js               the project's locales and strategy, which the runtime reads
  plurals-<hash>.js              each locale's plural rules, compiled from CLDR
  formats-<hash>.js              the Intl formatters messages call, when any does

  .grai/manifest.json            what the output was compiled from, and its files
  .gitignore                     `*`: the output is compiled, never committed
```

The first five are the entries, which apps import by name. Every other file is named by a hash of its content, so a compile never replaces one (see "Incremental compiles and atomic output").

- **The output has Git ignore it, through a `.gitignore` of its own.** Git, Prettier 3, Biome with its VCS ignore, and editors' searches then skip it with no setup. ESLint's flat config does not read `.gitignore`, so a project lists the outdir in its `ignores`. There is no option to commit the output, as neither reference app does. The outdir is grai's alone, so the config rejects one that holds the config or a catalog, which the `.gitignore` would hide.
- **On disk, a few modules hold every message.** Node, scripts and tests load them as they are, and the output is a few dozen files whatever the key count. Per-key files would cost every install, editor index and file watcher, two files a key: 26.7k for app B.
- **The keys are split into shards by a hash of their name**, a power of two of them so that a key moves only when the key count doubles. An edit then writes one shard of about 512 keys, under its new name, not the whole catalog's output. TypeScript and editors read that shard alone.
- **Per-key import paths map to keys.js with one line, never a file per key.** An app that imports `import { key } from "…/messages/key.js"` maps the pattern in its package.json `imports` (`"#i18n/messages/*": "./src/lib/i18n/keys.js"`). Node and TypeScript resolve every key's path to keys.js and its declarations, and a key that does not exist is a type error at the import. The Vite adapter resolves the same paths itself.
  - **A file per key was measured and rejected.** A `.js` and a `.d.ts` per key, each re-exporting the key from keys.js, made app B's output 26,762 files instead of 109. Its compile went from 194 ms to 2,758 ms cold, from 2.9 to 37.9 ms with nothing to do, and from 38.6 to 102.9 ms for one edited message (medians of three, load 13–21).
  - **So Node and TypeScript see one module for every key's path.** A test runner that loads the paths without the Vite plugin mocks every key when a test mocks one key's path. An editor's auto-import offers keys.js rather than the key's path, since TypeScript cannot turn a pattern that maps to one file back into a key's path.
- **A production build splits by key, from memory.** Measured with Vite 8.3 (Rolldown) and Rollup 4.52, on two entries that use two keys each, one key shared:
  - one module of keys: static member access on its namespace drops the unused keys, but every key used anywhere lands in one shared chunk, so each route carries the others' words;
  - one module per key: each entry's chunk carries only its own keys, and the shared key gets a chunk of its own.

  So the Vite adapter builds one module per key from the compiler's model, and `keys.js` and the per-key paths resolve to them. They are never files, and the adapter's build test pins both results.
- **Dev serves one module.** A dev page then requests every message as one module, whatever the key count, and every per-key path resolves to that same module.
  - **A test run is the exception.** In Vite's test mode, which Vitest runs, each key's path resolves to a module of that key alone, a re-export from keys.js. A test that mocks one key's path then mocks that key and no other, and an edit still reaches the key through keys.js.
  - **A page keeps one module because a module per key costs it a request each.** On app B's catalog, a dev page importing 300 keys by their paths loaded in 445 ms rather than 346 ms the first time, and in 103 ms rather than 54 ms on a reload (medians of three, load 13).
  - **A test run pays about the same per key's path**, the price of mocking one key. Through the server's module runner, as Vitest loads a test, the 300 imports took 897 ms rather than 691 ms.
  - A missing key's path resolves to a module whose one export throws a `GraiError` naming the key when called, and the plugin reports the import in the overlay. The import itself succeeds, because a failed import would set off Kit's stale-deployment reload.
  - A key the build has still resolves to keys.js outside a test run, so a page that imports hundreds of keys by path loads no module more for them (app B has 23,379 such imports in 1,924 files). The plugin resolves these paths before Vite does, since Vite's resolver would take them straight to keys.js.
  - It keeps each per-key import's importer, so that a build that adds or removes the key has the importer resolve it again: an added key reaches keys.js, and a removed one the module that throws.
- **The per-locale variants of the message modules exist only in memory too.** They have the same exports, with one locale's function each, and the bundler adapters build them from the compiler's model.
- **The output brings its own runtime.** `runtime-<hash>.js` is the package's runtime module, with its import of the config naming the output's `config-<hash>.js`. The output imports nothing from `grai`, so it runs wherever the app's code runs: a Worker, a script, or a server bundle that leaves out its dependencies.

### The browser's locale

The server picks the page's locale. The client's locale is the page's `<html lang>`, which the server writes, so the page hydrates in the words it was drawn in. A production client build loads only that locale's variants of the message modules it uses.

They come through an import map, which keeps the framework's single client build (`docs/runtime.md`):
- **The Vite plugin puts the key modules in chunks of their own,** by the entries that use them, under a directory `grai` within the one the bundler would have used (Astro's `_astro/` gives `_astro/grai/`, Kit's `_app/immutable/chunks/` gives `_app/immutable/chunks/grai/`). Within it, because hosts serve that directory as immutable and nothing beside it: `@astrojs/node` caches `/_astro/*` for a year and a sibling `/grai/` not at all. The runtime has a chunk of its own, so a message chunk holds keys and nothing else.
- **A set of keys has a chunk of its own once its modules reach 4 KB; smaller sets pool.** The keys the same entries use form a set, and one chunk per set loads exactly the keys a page uses. But most sets are a key or two: on app B, 1,909 sets made a page load 80 message chunks (median), each a request, a preload link, and imports and exports that compress poorly alone. So the plugin chunks keys in Rolldown's own `codeSplitting` groups:
  - the keys a first paint needs (Rolldown's `$initial` tag) are chunked apart from the keys only a later import needs, so a first paint loads none of the latter;
  - among each, a set whose modules' code, every locale's words with it, reaches 4 KB is a chunk of its own, and every entry that loads it uses all of it;
  - each smaller set joins the set nearest it by the entries that use them (`entriesAwareMergeThreshold`) until it reaches 4 KB, and the larger sets keep their own chunks. The words a page loads and does not use come only from sets under 4 KB.

  On app B a page then loads 26 message chunks (median) rather than 80, and 61% more keys than it uses, in 5% fewer bytes (963 against 1,010 KB of English, brotli, summed over 89 pages): a larger chunk compresses better than the words it adds. On app A, 17 chunks rather than 49, for 3% more English bytes and 8% more Russian, and 1.5% less JS a page. 4 KB is the knee: at 2 KB app B's pages load 35 chunks for 9% fewer bytes, and at 6 KB 23 chunks for 12% more. Rolldown's merge in one group alone also merges a small set into a large one, and every entry of the small set then loads the large one: 24 chunks a page, but 25% more bytes than one chunk per set.
- **Key modules import the output by `grai:output/`, a prefix of grai's, not by its path.** The bundler weighs a module by its code, and with the output's path in each key module the same project would chunk differently in another directory.
- **The formatters stay in the runtime's chunk.** A chunk of their own would spare a page without formatted messages their bytes, for one more request on every page with one. App A has no formatted message, and app B's formatters take 223 bytes brotli.
- **Each message chunk has a copy per locale,** under the sibling `grai-<locale>/`, with the same file name, imports and exports. Each key's call keeps only its locale's variant, at its locale's position, so the runtime picks it for the page's locale. A sibling, not a subdirectory, so the copies' relative imports reach the same shared chunks.
- **The server writes the import map,** from `…/grai/` to `…/grai-<locale>/`, and points the page's `modulepreload` links at the copies, as browsers apply no import map to `modulepreload`. Without the map a page still works, with every locale's words. This is the SvelteKit adapter's part, still open (`docs/followups.md`).

**Every client rule is the same in every build, dev and tests included, so nothing fails only after deploy.** On the client, a forced `{ locale }` must be the current locale. Any other throws a `GraiError` (`locale-not-loaded`) naming both locales, and in dev the key too. A build leaves key names out of the page: on app A they would add a third to its gzipped message bytes, and the call site in the stack names the key.

### A Svelte component reads a message without inputs as its string

`grai/svelte`'s plugin is `grai/vite`'s, and in the client build it also rewrites each component: a call of a text key with no arguments, `{m.title()}`, or `{title()}` of the key's own import, becomes a read of that key's string in the page's locale. The string comes from a module of its own (`grai:text/title`), whose `pageText(…)` picks the page's locale once, as the module is evaluated.
- **Svelte draws an imported value as plain, and treats a call as possibly stateful.** It gives each message call a derived signal and runs it as the page hydrates; a string it sets once. On a page of 2,000 calls with app A's catalog, built by Vite through both plugins, the strings hydrate in 16.2 ms against 24.3 ms for the calls at a 4× CPU slowdown, two-thirds of the way to text inlined into the template (12.9 ms, `svelte-texts`).
- **Inlining the text into the template would close the rest,** for a copy per locale of every component chunk with such a text; whether that pays is open (`docs/followups.md`).
- **The string modules go into the message chunks, and into their copies per locale,** like the keys, so a page still loads only its locale's words.
- **A call is rewritten only where it is certain to be grai's.** Names are followed to keys.js through the app's own re-exports, as the bundler binds them. A component that declares one of those names again, as an `{#each}` item or a parameter, is left as it is, and so are calls with arguments (a forced locale among them), markup, values and dynamic keys.
- **The server build and dev keep every call:** a server renders each request in its own locale, and dev patches a message's function in place. So does `"switch": "live"`, whose page re-renders in another locale.
- **The plugin reads each component after Svelte's preprocessors and before its compile,** so `grai()` is listed before `sveltekit()`. Listed after, the build fails and says so.

### Switching locale on the client: a choice

Tests switch the locale within the page, and so do many apps, without a reload. A production page holds only its locale's words. The config's `"switch"` picks one of two designs, each the same in every build:

- **`"reload"`, the default: no switch within the page.** `setLocale(locale)` reloads or navigates, so a page keeps its words while it lives. `setLocale(locale, { reload: false })` still sets the locale for a test and for code that draws nothing, and the messages called next are in it. A Svelte component already drawn keeps its words, as it always has: a message call reads no signal, so Svelte never runs it again.
- **`"live"`: load, then switch.** `setLocale(locale, { reload: false })` imports the target locale's variants of the message modules the page holds, then switches, and the app re-renders. It is not built yet (`docs/followups.md`).
  - In that mode it returns a promise that settles once the switch is done.
  - `setLocale(locale)` keeps reloading and returns nothing.
  - In dev and tests, where every locale is loaded, the promise settles at once.
  - The adapters must know which message modules a page holds.

## The generated functions

```js
// keys/3.js, a shard, for locales ["en", "de"]
import { message, text } from "../runtime.js";
import { plural_en } from "../plurals.js";

export const cart_title = /*#__PURE__*/ text("Your cart", "Ihr Warenkorb");

export const cart_items = /*#__PURE__*/ message(
	(i) => (plural_en(i["count"]) === "one" ? `${i["count"]} item` : `${i["count"]} items`),
	(i) => `${i["count"]} Artikel`,
);
```

- **One plain function per locale, in `locales` order.**
  - `message` returns `(inputs, options) => variants[index of (options?.locale ?? the bound locale)](inputs)`: one shared dispatcher, not a copy per key.
  - A message without inputs is a string per locale (`text`).
  - One locale may use a plain pattern where another selects: the German above needs no plural.
- **A message with markup also has `.parts()`**, built the same way. A part is `{ type: "text", value }` or `{ type: "markup-start" | "markup-end" | "markup-standalone", name, options, attributes }`. An option is a literal, or the value of an input or local (a formatted local as its text); an attribute is a literal, or `true` when it has none. The app then decides how markup looks, and translators decide where it stands.
- **Inputs are read as `i["name"]`, not `i?.name`.** The types require them, and the body is repeated in every message function (40k in app B). The brackets keep an app's checkJs clean under `noPropertyAccessFromIndexSignature`, which `@tsconfig/strictest` sets, as the compiled functions take their inputs typed by an index signature. A minifier writes them back as `i.name`, so a browser's bundle does not change; a server build, which is not minified, grows 1%: app A's Vite server build from 2,189,415 to 2,213,025 B. Taking the inputs apart in the parameter, `({ count: _count }) =>`, was the other way: it reads every input a function names on every call, and it is larger minified and slower to load. App A's minified `keys.js` is 1,506,516 B against 1,500,110 B, 2.6 KB more brotli, and loads in 35.7–41.2 ms against 24.3–30.6 ms in a new Node process (`startup`, two interleaved rounds at a load of 14–27).
- **A server build writes each locale's function as a function expression, `function (i) { return … }`.** V8 parses every arrow function of a module in full when it loads the module, but only pre-parses a function expression, until its first call. A server loads every locale's functions and a request calls few of them, so the Vite plugin's server build loads app A's messages about a fifth faster (`docs/runtime.md`). The browser's modules and `keys.js` keep arrows, which are shorter.
- **Calls are not replaced after the framework compiled them.** Each locale's function is a pure arrow of its inputs, so a bundler transform could put a call's string in its place, in a build per locale. But Svelte has by then compiled each call as a dynamic expression, and the string stays inside it: on the page of 2,000 calls the strings hydrate in 23.9–24.1 ms against 23.3–24.3 ms for the calls at a 4× CPU slowdown, where `grai/svelte`'s, put in before Svelte compiles, take 15.9–16.2 ms (`docs/runtime.md`). It would also take a copy per locale of every client chunk that calls a message, 978 more files on app A. Inlining the text into the template is the open question (`docs/followups.md`).

## Declarations

```ts
// keys/3.d.ts
import type { Message } from "../runtime.js";
/** Your cart */
export declare const cart_title: Message;
/** {count} item (en, one) … */
export declare const cart_items: Message<{ count: number }>;
```

- **The compiler writes the `.d.ts` files itself, as text, from the same model as the JavaScript.** It never runs TypeScript. Declaration emit through TypeScript takes most of a compile at this catalog size: Paraglide's compile of app A takes 3.8 s, and 32.1 s with TypeScript's declarations (`compile-time`).
- **The types are named in the generated `runtime.d.ts`:**
  - `Locale` is the union of the locales.
  - `Message<I>` is `(inputs: I, options?: { locale?: Locale }) => string`.
  - A message without inputs takes `inputs?: Record<string, never>`.
  - `MarkupMessage<I, T>` adds `.parts(): MessagePart<T>[]`, where `T` is the union of the tags every locale writes. A part named otherwise is a type error, so an app's renderer can map exactly those tags.
  - Messages return `string`.
- **An input's type is what every use of it takes, in every locale:**
  - `number` where a locale counts it with `:plural` or formats it as a number or a relative time, `Date | number` where one formats it as a date, and `readonly string[]` where one formats it as a list;
  - the keys, as numbers and strings (`1 | "1" | …`), where a locale selects on it and lists its values without `*`;
  - `string` where it gives a formatter an option, such as `currency=$code`;
  - `string | number | bigint | boolean | object` where it is shown as text, which is what a template literal turns into text: a symbol has none, and throws in a message's text and in its parts alike;
  - `NonNullable<unknown>` where it is only selected with `*` or given to markup.

  Each use narrows the type, so an input both selected on `1` and `2` without `*` and formatted as a number is `1 | 2`, and one a locale selects on `a` and `b` and another on `a` is `"a"`. Two uses no value suits both of, such as `{x :currency currency=$x}`, which formats `x` as a number and takes its currency from it, are a compile error naming both, so a call that type-checks renders in every locale. A key's inputs are the union over its locales.
- **The doc comment is the base locale's text**, so an editor shows the words at the call site.
- **Go to definition lands on the key in the base locale's catalog.** Each shard's declarations have a declaration map, from each key's name to the line its key is on in the base catalog, and TypeScript 6's tsserver and TypeScript 7's language server both follow it. An edit regenerates the maps only when it moves a key to another line, so a message's new words cost no map.
- **The output's JavaScript type-checks too**, under `checkJs` with `strict`, as an app with it in `src` checks it. `runtime.d.ts` declares what the shards and `server.js` import from the runtime, and `config.js` and `plurals.js` carry JSDoc types.
- **The declarations are sharded like the modules.** One file loads a little faster in an editor the first time, but an edit rewrites it whole, so every edit after costs more. A file per key costs the most in `tsc` and in completion alike.

## Selection: plurals and selects

These are MessageFormat 2's rules, restricted to the constructs above:

- **`local n = count: plural` selects the CLDR cardinal category of `count`** for the message's locale, through a function compiled from CLDR's rules for that locale alone. A whole, non-negative count, the usual one, takes a path with the fraction operands folded away; any other count is rounded to three fraction digits first, as `Intl.PluralRules` rounds it, and one that is not finite (`NaN`, `Infinity`) is `other`, as `Intl.PluralRules` gives it. That is 4–11 ns a call against 124–249 ns for a cached `Intl.PluralRules` (`plurals`), and every locale agrees with `Intl.PluralRules` on 0–10,000, on fractions, on negative counts and on counts that are not finite. The rules are CLDR 48's, from the `cldr-core` package, so a project's categories are the same on every engine; the compile checks the variants against them.
- **`local n = count: plural type=ordinal` selects the CLDR ordinal category of `count`** (`one` for 1st, 21st, `two` for 2nd in `en`), compiled from CLDR's ordinal rules the same way, and Paraglide's `plural` takes the same option. Every locale agrees with `Intl.PluralRules` of type ordinal on 0–1,000 and on fractions. A language whose every count is `other`, as 66 of CLDR's 108 rank (`ru`, `de`) and 34 of its 224 count (`ja`, `zh`), gets a function that returns it without reading the count, so a bundle of it carries no operands.
- **A `:number`, `:integer` or `:percent` local selects as MessageFormat 2's `:number` does.** A key that is a number matches a value equal to it, and a key that is a category matches the value's category: cardinal by default, ordinal with `select=ordinal`, and none with `select=exact`. An exact match comes before a category, so `n=1` is chosen for 1 over `n=one`. `:integer` rounds the value half away from zero first, as it shows it.
  - A key is compared with the value as JavaScript writes the number, which is MessageFormat 2's serialization for a whole number. So, for a local that does not round, `1.0` and `01` can never match, and they are compile errors, as is a fraction under `:integer` or `:percent`.
  - A local whose options round it (fraction or significant digits, `roundingMode`, `roundingIncrement`, `roundingPriority`, `trailingZeroDisplay`) selects on the digits it shows, as `Intl.PluralRules` does given the same options. With `minimumFractionDigits=1`, 1 shows as `1.0`: it matches the key `1.0`, and is `other` in English, where 1 is `one`; the key `1` is a compile error, as no value shows it. The digits are an `Intl.NumberFormat`'s with the local's options, in Latin digits and without grouping, the same in every locale, and the category is the compiled rules' reading of those digits as written, trailing zeros included. Every locale agrees with `Intl.PluralRules` on nine sets of such options, cardinal and ordinal.
  - `signDisplay`, `useGrouping`, `numberingSystem` and `minimumIntegerDigits` only change how a number is written, and a selector takes them. A local in another notation or with a style (`notation`, `style`) is refused as a selector: it shows more than digits, and `Intl.PluralRules` has no category for that.
  - `:percent` selects the same way, always by the cardinal rules, on the whole percent it shows. 0.29 is 29: the decimal point is moved two places, where `0.29 * 100` is 28.999999999999996. 0.014 is 1, as `1%` shows it: the percent is rounded half away from zero, as `Intl.NumberFormat` rounds it.
  - A currency, a unit, a date or a time does not select, in MessageFormat 2 or in grai.
- **A selector on an input matches a key when `String(value)` equals it.** That is MessageFormat 2's string selection, so `1` and `"1"` both match the key `1`.
- **A `:string` local selects as MessageFormat 2's `:string` does:** a key matches when it and the value's text are the same in Unicode's NFC, so `café` matches whether the value writes é as one character or as e and an accent, and two keys NFC writes alike are a compile error. Each call normalizes the text once. A selector on the input itself, the inlang format's own, compares them as written, as Paraglide does. `{name :string}` shows a value as `{name}` does, and the local shows its input's value.
- **The variant is chosen by MessageFormat 2's preference:** among the variants whose every key matches, a literal key comes before `*`, and a number's exact key before its category, selector by selector, and then the order written.
- **A selection must be exhaustive, or it is a compile error:**
  - every plural selector, and every number selector but an exact one, covers every CLDR category of its locale, or has `*`, and every combination is covered when there are several;
  - an exact number selector has `*`, for the numbers its keys do not list;
  - a key that is not a category of the locale (`few` in `en`) is an error, because it can never be chosen.

  An uncovered count would otherwise render the key's name. Both reference catalogs already meet this rule.
- **A select on an input without `*`** (`month=1` … `month=12`) is closed by its type. A value outside it at run time throws a `GraiError` naming the key, the locale and the value.

## Formatting: numbers and dates

- **The options are Intl's, by name.** MessageFormat 2's number functions' options already are `Intl.NumberFormat`'s, and `:number` also takes `style` and the options that go with it, such as `style=percent` or `style=currency currency=EUR`. `:percent`, `:currency` and `:unit` are `Intl.NumberFormat`'s styles, and take the options MessageFormat 2 lists for each. `:currency`'s `fractionDigits` is both of Intl's fraction digits, and `auto` the currency's own; `:currency` needs `currency`, and `:unit` needs `unit`. `:unit`'s `usage` would convert the value into the units the locale prefers, which Intl cannot, so it is a compile error. MessageFormat 2's date and time functions are a draft whose options are still changing, so `:datetime`, `:date` and `:time` take `Intl.DateTimeFormat`'s options, such as `dateStyle=long`. Given no option that shapes the text, they use MessageFormat 2's defaults: a medium date, a short time.
- **`:relativetime` and `:list` format through `Intl.RelativeTimeFormat` and `Intl.ListFormat`,** made once like the others. `:relativetime` needs `unit` (`unit=day`), which Intl takes with each value, and its input is a `number`; `:list`'s is a `readonly string[]`.
  - **They take the bare names.** MessageFormat 2 defines neither, and asks that a function it does not define take a namespace, since a bare name may be defined later. But Paraglide already compiles `:relativetime unit=…`, so with the bare name its catalogs compile unchanged, and `:list` follows so that the functions read as one family. Both take Intl's options by name, as MessageFormat 2's own number and date functions do, so a definition it adds is likely to match; where it does not, grai follows the specification.
- **The options are checked when compiling,** by making the formatter once. An option a function does not take, or a value Intl refuses, is a compile error naming them.
- **Each locale and options gets one formatter, in `formats.js`, made the first time it formats.** Made at module scope, every locale's formatters would be made on every page load. A formatter made once formats a number in 207–213 ns and a date in 462–526 ns, against 8.3–9.3 µs and 21.7–23.9 µs for a new one per call (`intl`).
- **A formatted value is passed to Intl through `Number()`,** as Intl itself takes a date by its time value.
- **An option the app's data decides can come from an input: `currency=$code`, `unit=$unit` and `timeZone=$zone`.** Which currency an amount is in, which unit a quantity or a relative time is in, or which time zone a reader is in, is data. How the value looks, its style and its fields, is the message's to write, so those options stay literal and are checked when compiling.
  - The compile checks such a call with a value the option takes, so the literal options around it are still checked. A currency needs `style=currency` written beside it, and a unit `style=unit`, or Intl would leave them out. So a call takes one option from an input at most.
  - The input is typed `string`. A value Intl refuses throws a `GraiError` with the code `format-option-invalid`, which names the option and the value.
  - Each value gets its own formatter, made the first time it formats and kept in a map. A number formats in 216–305 ns with its currency from an input, against 205–248 ns with it written; Paraglide, which finds a formatter by the options each call builds, takes 688–1,054 ns (`option-inputs`).
  - `:relativetime`'s `unit=$unit` is the exception, as Paraglide takes it too: Intl takes a relative time's unit with each value, not when its formatter is made, so the call keeps one formatter and passes it the unit. The input is typed `Intl.RelativeTimeFormatUnit`, and a value that is not one throws the same `GraiError`.
- **A date's time zone is an input, not a value bound once per request as the locale is.** Bound per request, it costs a date the same, 450–556 ns against 447–601 ns from an input (`option-inputs`), so the choice comes down to where the zone is known. A server and a page agree on a date only if both read its zone from the same place. With an input, that place is the app's own data, which it already renders on the server and hydrates with. A zone bound per request would also have to reach the page, and every date without a zone would still differ between a server, which formats in its own zone (UTC on Workers), and a browser, which formats in the reader's.

## Errors

- **Every failure is a `GraiError`** with a `code`, the `file`, and the `key` and `locale` where they apply. Its message says what is wrong and what to do: for example, `messages/pl.json: "cart_items" (pl): no variant matches countPlural=many. Add one, or a variant with * for the selectors it does not care about.`
- **A compile reports every error at once, sorted by file, key and locale, and exits non-zero.** It leaves the last good output in place, and the Vite plugin shows the errors in the overlay while the last good output keeps serving.
- **Anything grai needs that it cannot read or parse is an error that names it:**
  - the config file, a field of it, a configured locale's catalog, or a catalog that is not JSON;
  - a catalog with no messages, which is an error for its locale.

  A compile never succeeds with fewer locales or messages than configured, and each of these cases has a test.

## Incremental compiles and atomic output

- **A compile reads the catalogs as bytes and hashes them first.** When the manifest says the output was compiled from the same config and bytes by the same compiler, and every file it lists is there, the compile stops: nothing is parsed and no file is touched. "The same compiler" is a hash of grai's own modules, taken once a process, because the version alone would miss a local build of grai.
- **A recompile after an edit redoes only what the edit changed.** It keeps the last build in memory: each catalog's bytes and parse, each key's compiled code, each shard's text.
  - A catalog whose bytes are the same is not parsed again.
  - An edited catalog laid out one entry per line, as editors and formatters write them, has a line break and the same indent before each top-level key and nowhere else, because a JSON string holds no raw line break. The edit's changed bytes lie between two such entry starts, so only that span is parsed, in the old file and in the new. The span must be whole entries with their separators: a comma or the opening brace before it, and a comma after it unless it closes the object. Whenever that cannot be shown exactly (another layout, a duplicated key, a span that does not parse, a separator missing or one too many), the whole file is parsed instead, and reports what is wrong.
  - Only the keys whose messages changed are compiled, and only their shards are rendered and written.
  - A failed recompile leaves the last good build as it was, so the next one starts from it.
- **Watching covers the config and the catalog files, nothing else.** No other file can start a compile, so a framework's generated files never trigger one.
  - Each file is watched as a file, not through its directory, whose events macOS reports late.
  - The watches are set up again before each compile, so a file an editor saves by renaming another over it is seen, and so is a change during the compile.
  - A catalog that does not exist yet is watched for through its directory.
- **Each file is written to a temporary file of the writer's own in `.grai/` and renamed into place**, which is atomic on POSIX file systems. A reader sees the old file or the new one, never part of one. The texts go to their temporary files all at once; then the files named by their content are renamed into place, then the entries.
- **A compile publishes the output whole, and a reader sees one compile's output, never two mixed.** Whole files are not enough. When an edit changes a formatter's options, `formats.js` and a shard change together, and a reader that loads between the two renames gets the new `formats.js` beside the old shard, which imports a formatter it no longer exports. No order of the writes avoids it: the opposite order fails the opposite way. Nor does a `formats.js` that keeps both formatters until the shards are written, since a reader whose load spans the compile still reads one shard before and the other after, and a doubling of the shard count, which moves keys from shard to shard, has no such order at all.
  - **Every file that only the output imports is named by a hash of its content** (`keys/3-1f0c2b7a9e4d.js`, `formats-….js`, `runtime-….js`), so it is written once and never replaced. A shard's module and declarations share their name, so TypeScript reads the declarations and not the module, as it does for any `.js` beside its `.d.ts`.
  - **The entries keep their names:** `messages.js`, `keys.js`, `runtime.js`, `server.js` and `config.js`, with their declarations, which apps, package.json `imports` and adapters name. Each imports its output's files by their names, and is renamed into place once they are all there. A module loader reads a module before the modules it imports, so whichever entry it read, every file it then reads is of that entry's compile.
  - **Content that does not change keeps its name,** so an edit writes one shard under its new name, its map, and the two entries that name it, `keys.js` and `keys.d.ts`, and every other file stays as it is, with file watchers', Vite's and TypeScript's state of it. A compile also skips any file that the last one left in place, which makes undoing an edit cost no more than the edit.
  - **A file the output no longer names stays for ten seconds,** for a reader that read an entry of the compile before and has the rest still to load, and the next compile after that removes it. A module loader takes milliseconds to read an output.
  - **A declaration map is named by its shard's index, `keys/<n>.d.ts.map`, and replaced in place.** TypeScript follows a map only when the map names its declarations, so a shard's is written again with the shard. A key added near the top of the base catalog moves the lines of every key after it, in every shard: the maps are then written again, and no shard is renamed, which would have TypeScript read every declaration again. Only go to definition reads a map, after its declarations.
  - **A shard names the modules it imports, so a new one renames every shard that imports it.** The formatters' module changes only when a message adds or drops a formatter's options, and the runtime's only with the config or grai: neither app A's catalogs nor app B's format a value yet.
- **What is in the outdir is learned from the outdir.** The manifest names each file of the output, with a hash of what each entry and map holds, and a compile writes a file that is missing from a listing of its directory, or whose hash the manifest does not record. Nothing is taken from the last compile's memory of what it wrote, which another writer or a file deleted by hand makes wrong. A compile that replaces a file removes the manifest first and writes it last, so one that stops halfway leaves no manifest to trust.
- **Two entries are read at two moments.** A process that imports both `runtime.js` and `messages.js` loads each one's output. A catalog edit changes `keys.js` alone among the entries' imports, so the two always agree. A change of config or of grai renames the runtime, and with it every entry, and a process that loads during those renames can hold two runtimes.
- **The other designs, weighed and set aside:**
  - **A directory per compile, swapped in by one rename of a symlink.** Node, Vite and TypeScript resolve a symlink to the real path, so a reader stays in the compile it started in. But every edit then moves every file to a new path: TypeScript reads every declaration again, and Vite takes every module for a new one, so an open page that imports one more module loads a second runtime.
  - **A versioned import map**, which the entries would resolve through. Node and TypeScript read no import map, and the package.json `imports` an app maps its keys with are read once per process.
- **One writer per outdir.** The writer takes a lock: a file holding its pid, linked into place from its process's claim, a file of its own made once (`lock.<pid>.<uuid>`), so that the lock never exists empty and no two writers share a claim, two threads of a process among them. A process's compiles take the lock in turn, a live writer's lock is waited for, and making a claim removes the claims of processes no longer running. The CLI's `watch` and the Vite plugin can then share an outdir.
  - **A lock whose writer is gone is not taken over: the compile fails and names the file to delete.** Writers that each found the lock stale could each remove it, the later removing the lock the earlier had just taken, and then both write. A lock that is sound to take over is one the operating system releases when its process ends, such as `flock`'s, which Node does not offer. The lock is held only while a compile writes, so it is left behind only when a grai stops during those few milliseconds.
- **In dev, the Vite plugin serves from memory and sends HMR itself.** It watches the config and the catalogs with `fs.watch` (3–10 ms to see a save, against 48–114 ms for Vite's watcher: `hmr`) and ignores every other file, and the output directory's changes are its own, so a compile is never reported twice. The plugin still writes the files, for TypeScript and editors.
- **An edit patches the page in place.** The dev module keeps every key's locales in a table. After an edit the plugin sends only the changed keys' functions, as a module the page imports; the page writes them into the table and dispatches a cancelable `grai:change` event on `window`. A framework adapter that renders again cancels it; otherwise the page reloads. The server's dev render takes the same patch, so an edit never evaluates the app again. A key added or removed, or a change of locales, reloads the page, and the server's environments take the module again. It is 17–30 ms from the save to the page, against 202–459 ms for re-sending the whole module (`hmr`).
- **A framework whose pages the server draws has the plugin reload them instead** (`reloadOnEdit`, for an adapter such as Astro's). An Astro page with no island loads no module of messages, so nothing on it could take a patch, and the words outside its islands are the server's anyway. The servers are sent their patch first, so it is under way before a reloaded page asks for a render; as on the in-place path, nothing waits for it to land.

## Runtime

The locale is resolved once per request on the server, or once per page on the client. A message call reads that bound value and never runs a strategy.

- **On the server, `server.js`'s middleware resolves the locale and binds it** to the request through `AsyncLocalStorage`. Its strategies:
  - `cookie`;
  - `preferredLanguage` (`Accept-Language`): its ranges by weight, as RFC 9110 reads them. A malformed range or weight (`q=2`, `de_DE`) is left out, and `q` is read in any case. `q=0` refuses every locale its range names (`en;q=0` refuses `en` and `en-GB`), and `*` takes any locale no other range names, the base locale first. A range reaches a locale as itself, then as each parent it is cut down to, as written and then in its likely form from CLDR (`zh-Hant-TW`, `zh-Hant`, `zh`; `zh-TW` is `zh-Hant-TW`), and never as a sibling: `en-AU` reaches `en`, not `en-GB` or `en-US`, which a config's order would otherwise choose between. A site that wants `en-AU` to read `en-GB` lists `en-AU` with a fallback to `en-GB`;
  - `url`: a non-base locale is the first path segment, and the base locale has no prefix. A locale's home page is `/de`, not `/de/`, which SvelteKit and Next would redirect to drop the slash; every other path keeps the slash the app wrote.

  The base locale is always the last resort, so the config does not list it. `url` comes last unless every locale's paths are prefixed: every path names a locale, the base locale's when it has no prefix, so the config rejects a strategy after it, which would never be read.
- **With `"localePrefix": "always"`, every locale's paths have a prefix, the base locale's too,** so a path without one names no locale. The strategies after `url` then find the request's locale, which is the usual "the URL's locale, else the cookie's, else `Accept-Language`". The middleware sends a GET or a HEAD for such a path to that locale's path, with a 307: it keeps the method, and no cache keeps it for good, as the locale it found is the request's. Any other request is answered in that locale where it is, as a form's POST must not be sent elsewhere. `"as-needed"`, the default, leaves the base locale's paths unprefixed, as most sites have them.
- **`localePrefixes` gives a locale a prefix of its own** (`{ "en-US": "us" }`), one lowercase path segment that no other locale has, so its paths are `/us/…`. Without one, a locale's prefix is its tag.
- **`unlocalizedPaths` names the paths `url` leaves alone,** as globs (`["/app/**"]`): an app's pages kept by cookie beside public pages localized by URL, or an API that must not be sent elsewhere. Such a path has no prefix and names no locale, so the strategies after `url` find its locale, the middleware sends it nowhere, and `localizeHref` gives it back as it is. The globs are compiled into `config.js` as regular expressions, so a request tests them without parsing them.
- **Each of these options is a constant in `config.js`** (`prefixesEveryLocale`, `customPrefixes`, `leavesPathsAlone`), checked where the runtime would run that option's code. A bundler folds such a constant across modules and drops the code it guards, so a page pays only for the options its config names: the URL helpers a page calls are 579 B brotli with none of them, against 588 B before the options existed, and 612 and 614 B with `localePrefixes` or `unlocalizedPaths` (`bench/url-bytes.mjs`). Checking each option's value when the runtime runs instead would carry every option's code on every page.
- **The middleware's response lists in `Vary` the request headers its strategy reads:** `Cookie` for `cookie`, `Accept-Language` for `preferredLanguage`, and none for `url` or for the strategies after it, which it never reads. A shared cache then keeps a copy per locale, not one locale's page for every reader. They are appended to the handler's own `Vary` without reading it first, which would cost every request a header read: a header listed twice means the same to a cache. A response from `fetch()` has immutable headers, and no platform can say so in advance, so such a response is copied.
- **A call reads the bound locale once and indexes its variant with it:** the request keeps the locale's position in `locales`, so there is no search and no strategy per call. `setLocale` in a request changes the locale for the rest of that request, and for no other: it writes the state the middleware binds for the request, as Workers have no `AsyncLocalStorage.enterWith` to bind a new one.
- **On the server outside a request** (scripts, crons, Node tests), one process-wide value is bound. It starts as the base locale, and `setLocale(locale, { reload: false })` changes it.
- **On the client,** the page's `<html lang>` is the locale, else the base locale. `setLocale(locale)` writes the cookie (`cookie`) or goes to the localized URL (`url`), and reloads. With `{ reload: false }` it switches in the page, which holds every locale until an adapter builds one locale per page; what it does then is the open question above.
- **The cookie's policy is four options, named as Paraglide names them** (`cookieName`, `cookieMaxAge`, `cookieDomain`, `cookieSameSite`), each for a case an app meets: subdomains that share a preference, and a page embedded in another site's. `setLocale` writes the cookie Secure on https, as a browser drops a Secure cookie an http page sets. It is Secure always where the browser requires it: `SameSite=None`, and a `__Secure-` or `__Host-` name. A `__Host-` name with a domain is refused, as a browser would drop the cookie. There is no option to write it insecure on https, which nothing needs.

The runtime's names are the ones existing Paraglide call sites use, so migrating changes imports, not calls. Only the middleware has a name of its own:
- `runtime.js`: `getLocale`, `setLocale`, `locales`, `baseLocale`, `Locale`, `isLocale`, `assertIsLocale`, `cookieName`, `getTextDirection`, `MessagePart`;
- for the `url` strategy: `localizeHref`, `localizeUrl`, `deLocalizeUrl`, `extractLocaleFromUrl`. Without it they leave every URL as it is, since no URL then names a locale: in an app that keeps the locale in a cookie, `/de/…` is a path of its own, and a prefix would lead to a page it does not have;
- `server.js`: `middleware(request, ({ request, locale }) => response)`.

## Servers

- **One middleware serves every runtime, with no adapter.** It takes a `Request` and a handler and gives back the handler's `Response`: the shape of a fetch handler on Workers, Bun and Deno, and of Hono's middleware in one line, `(c, next) => middleware(c.req.raw, () => next().then(() => c.res))`. An adapter would add a name and no behaviour.
- **On Workers it needs only `AsyncLocalStorage`.** Workers have it by default from compatibility date 2026-08-04, with the rest of Node.js compatibility. On an earlier date the `nodejs_als` flag adds it alone, and without it the Worker does not start: `No such module "node:async_hooks"`. `test/workers.test.ts` runs the example under the default, and its interleaving Worker with `nodejs_als` alone.
- **A request's locale holds across its awaits in workerd, Bun and Deno, as in Node.** In the test, 30 requests in three locales go through the middleware at once in each runtime, and each renders again after an await, once all 30 have rendered, in its own locale or in the one its `setLocale` chose. They interleave inside one HTTP request, as no request may wait on another: workerd cancels a request that has nothing of its own left to run, as hung, and Bun closes one that has waited 10 seconds, so 30 requests that each waited for the rest failed now and then under load.
- **The tests get Bun and Deno from pnpm's runtime protocol** (`"bun": "runtime:1.4.4"` in the devDependencies), as they get workerd from Wrangler: one `pnpm install` brings every runtime they serve the example in, at a pinned version, with nothing installed globally.

## SvelteKit

- **`handleLocale({ middleware, getTextDirection })` is the whole server adapter.** It takes the two functions from the project's output, as every adapter takes the project's generated modules, and runs the middleware around Kit's `resolve`. The locale is resolved and bound once, for the page's render and its loads alike.
- **The page's locale and direction are written into `src/app.html` through `%grai.lang%` and `%grai.dir%`,** by `transformPageChunk`. They are placeholders, as Paraglide's `%paraglide.lang%` is, so migrating renames them, and the app keeps its `<html>` as it wrote it.
- **The browser needs nothing from the adapter.** The runtime takes `<html lang>` as the page's locale.
- **`reroute` is one line in the app,** `deLocalizeUrl(url).pathname`, and not an export: wrapping the output's own helper would add a name and no behaviour.
- **The import map to the page's locale's message chunks is not written yet** (`docs/followups.md`), so a page still loads every locale's words.

## CLI

- `grai compile` writes the output once; `grai watch` keeps it current, incrementally.
- `grai check` runs every compile check (lockstep, plural categories) without writing, and adds three of its own:
  - keys no shipped source file names. A key counts as named when it is an identifier anywhere in a JavaScript, TypeScript, Svelte, Vue or Astro file or an MDX document under the project, or under `--source`, outside dependencies, build output and the outdir. That counts `m.key` and per-key imports alike, and never calls a key unused that shipped code names;
    - **a test ships nothing, so a key that only tests name is unused,** and the report names those tests, which must change with it. Tests are the files the config's `tests` globs match, by path from the root: by default Vitest's and Jest's names (`*.test.*`, `*.spec.*`), Jest's `__tests__` folders, and the root's `test` and `tests`. A folder named `tests` deeper down may ship, as a SvelteKit route at `src/routes/tests/` does, and calling its keys unused would have `--fix` delete them. `[]` makes no file a test;
  - inputs one locale shows and another never does: a placeholder a translation lost or invented. An input a locale only chooses a variant by, such as the gender French agrees `invitée` with, is that language's grammar, and another locale need not read it; an `input gender` declared only to quiet the check would prove nothing.
  - each place a source names a key no catalog has, `m.foo`, `m["foo"]`, a per-key path or a named import of keys.js, with the `grai add` that adds it. TypeScript sees these only in TypeScript; in JavaScript and in a Svelte or Vue template such a call ships as a call of nothing. A Vite build fails on the same places in the shipped sources, where Rolldown only warns that a namespace's member is undefined (it fails a named import of one already).

  It also lists, per locale, the keys still untranslated: those whose message equals its seed, but the keys `identicalToBase` lists. This is a report, not an error, since a text can rightly read as the base locale's. `--json` prints the problems and the untranslated keys for scripts.
- `grai seed <locale>` gives a locale's catalog the base text of every key it lacks, and creates the catalog if there is none.
  - **Every key is in every locale, so an untranslated message is a seed, and equality to it is the marker.** Nothing is kept beside the catalogs.
  - **A message that rightly reads as the base text is listed in the config, under its locale in `identicalToBase`.** The report proved noisy without it: on app B it named 319 messages in one locale and 108 in another, each equal to the base on purpose (units, codes, words both languages share).
    - The list is in the config, not in a file beside the catalogs or as markers in them, so the catalogs stay the inlang format and every exception is in one reviewed place.
    - `check` and `export` take a listed key as translated, and `check` reports one that no catalog has or whose message is no longer the base text. A stale entry would otherwise hide a key that needs translating.
    - `rename` and `check --fix` change the list with the key, through the catalogs' one writer: only the list is written again, in the config's layout, and every other byte of the config stays.
  - A seeded plural keeps the variants the locale can choose, and its `other` becomes `*` unless a `*` already covers the same branch of the other selectors: a `*` for one gender says nothing of another's counts. It then compiles in a locale with more categories, such as `few` in `ru`. Each seed is compiled in the locale before anything is written, so a seed never leaves a catalog that fails.
- `grai export <locale>` prints a locale's messages for translators, or only the untranslated ones. `grai merge <file>` writes the translations back into the locale's catalog.
  - **The file is XLIFF 2.0**, the OASIS standard translation tools exchange, and both Weblate and Phrase read it.
    - A placeholder is a `<ph>`, and a pair of tags is a `<pc>` around its words, or an `<sc>` and an `<ec>` where it crosses another pair, so a tool keeps a translator from breaking either.
    - **A code's id names one code in all its message's units:** the same placeholder or tag pair, written alike, has the same id in each, and one written otherwise, such as `{amount :number}` beside `{amount}`, has its own. A translation's own codes are the message's too. An id by name alone would let a merge swap one variant's formatter for another's, or the base's for the translation's, and say nothing.
    - CSV, which every tool also reads, holds placeholders as text a translator can mistype, and has no plurals.
    - `--json` writes the same units for scripts, with each code as the catalog writes it, since Node reads no XML.
  - **A plural is one unit per category of the target locale,** each with a note of the counts it is for.
    - Each starts from the base text for the same counts. For `ru`'s `one` (1, 21, 31…), English gives both `one` and `other`, so the unit starts from `other`, which shows the count.
    - A translation may place any code of its message.
    - A row that does not tell counts apart, such as `count=0`, stays one unit.
  - **Once a locale has a message of its own, its units follow its selection,** which may tell apart what the base's does not, such as the gender French agrees `invitée` with, or nothing the base's does, as in a language without plurals. Each still starts from the base text for the same keys. A row the locale writes and the base lacks, such as German's `count=1`, is a unit too, so a merge never drops it.
  - **`merge` refuses a unit, never the file.** A unit made from a base text that has changed since is stale, and one that places a code its message lacks, or that the file gives twice, is invalid.
    - A message must still compile and show the base's inputs; one it only chooses by is the locale's grammar. A plural needs every form, from the file or from its current translation.
    - A message no unit changes is left as it is written, and the rest go to the catalog in one write.
    - A merged message keeps the shape of the locale's own message, or of the base's when it has none: a pattern stays a pattern, and a message with declarations keeps them, with selectors or without.
    - **Its declarations are the translation's,** which the forms no unit changes read, such as a price the locale formats in its own currency, **then each of the base's it lacks,** which a code a unit takes from the base may read. Taking the base's alone would reformat the locale's own forms, and the translation's alone would refuse a unit whose source reads a local the base has added since.
  - **Machine translation is not grai's.** grai fetches nothing, and a provider, its key, its prompts and a glossary are each app's choice. A script exports `--json`, translates, and merges, and the merge's checks refuse an answer that breaks a placeholder or a plural.
  - **A key's description for translators is a note of its units,** from the file the config's `descriptions` names: whether "Open" is a verb or a state, which no source text says.
    - The file sits beside the catalogs, not in them: Paraglide reads every key of a catalog but `$schema` as a message, so a description there would break the catalogs it reads. Not in the config either, as `identicalToBase` is: descriptions are many, and copy, not settings.
    - `grai import` fills it from FormatJS's descriptors, and refuses an import whose sources describe messages when the config names no file, rather than drop them. `rename` and `check --fix` keep it in step with the catalogs, and `check` reports a description of a key no catalog has.
  - The XML reader reads only what this XLIFF needs, and strictly: no DTD, no entities beyond XML's five and numeric references. A tool's comments, CDATA, groups, segments, notes and metadata are read past or joined.
- `grai add <key> --en "…" --de "…"` adds a key to every catalog that lacks it, at once: a new key to every catalog, or one some locales lack to theirs. It refuses unless a text is given for each locale that lacks the key and for no other, so it never overwrites a message.
- `grai import --from i18next|icu <file or dir>…` converts another library's catalogs into the project's catalogs, for a migration. Each source file's locale is its name (`en.json`) or its directory's (`en/common.json`).
  - **It writes new catalogs only, and nothing at all on an error:** an unreadable source, a file whose locale is unclear, two source keys that become one key, or a catalog that exists already. A migration then never overwrites edits.
  - **A message that cannot be converted in one locale is left out of every locale,** so the catalogs compile, and the report names it, its locales and why. The report also names what renders differently. A partial conversion would otherwise ship as a missing key or another locale's words.
  - **A key is its source path joined by `_`,** every character an identifier cannot hold as `_`. When a locale's directory holds several files, each key starts with its file's name, i18next's namespace.
  - **A plural is MessageFormat 2's `local nPlural = n: plural`, and an ordinal (ICU's `selectordinal`, i18next's `_ordinal_` forms) `local nOrdinal = n: plural type=ordinal`.** ICU's and i18next's `other` becomes `*`, because both take it for any count the other forms do not cover. An exact `=0`, and i18next's `_zero` in a locale without a zero category, becomes a choice on the input itself, written before the category, as both libraries try it first. A category the locale does not have is dropped, since neither library ever chooses it.
  - **Nested and sequential choices become several selectors, outermost first,** so MessageFormat 2's preference picks what ICU picks.
  - **A formatted value is formatted alike.** ICU's `#` becomes `{n :number}`. Its `number`, `date` and `time` arguments become `:number`, `:integer` and `:date` or `:time` with the Intl options of intl-messageformat's styles. i18next's `number` and `datetime` become `:number`, and `:datetime` with their options, or `:date` with Intl's default fields when no option chooses them. Its `currency(EUR)` becomes `:currency currency=EUR`, or `:number style=currency` when it passes an option `:currency` does not take; `relativetime` becomes `:relativetime` with its unit, `day` as in i18next; and `list` becomes `:list`. Each call is checked as the compiler checks it.
  - **i18next's ordinal forms become a key of their own, ending in `_ordinal`,** since i18next calls them by the plural's key with `{ ordinal: true }`. The report names each, so the call can move to the new key.
  - **An ICU skeleton is read as intl-messageformat reads it,** into Intl options, then written as the call those options make: `{price, number, ::currency/EUR .00}` is `{price :currency currency=EUR fractionDigits=2}`, `::percent` is `:percent`, `::unit/…` is `:unit`, and `{d, date, ::yMMMd}` is `:datetime year=numeric month=short day=numeric`. An option the function does not take, such as a sign on a unit, gives `:number` with the style instead.
  - **What grai cannot express is left out, never approximated:** an ICU currency style without a currency, a skeleton stem or date field Intl has no option for (`scale`, `integer-width`, `w`), `offset`, a format a project adds to i18next, nested values, and `$t()` with options or of a message with inputs. `$t(key)` of a text is inlined.
  - **Two differences are reported, not left out:**
    - an i18next plural that lacks a locale's form shows its `_other` text, where i18next showed the key's name;
    - i18next escapes the values of `{{name}}` and of a list for HTML by default, and grai gives them as they are. Escaping belongs to whatever shows the text: React, Vue and Svelte escape it, and an escaping message would show `&amp;` there, or in a native view. Every such message is reported, so code that set i18next's text as HTML can escape the values first. `{{- name}}`, numbers and dates are not reported.
  - `bench/import-equivalence.mjs` renders every imported message with grai and with i18next or intl-messageformat, for each locale and a range of inputs, i18next with its escaping off and then on, over values with HTML in them, and fails on any difference the report does not name. The libraries are the bench's dependencies, not grai's.
- **`find`, `rename` and `check --fix` read the sources through check's scan:** the same files, and the same notion of a name a source writes. None parses JavaScript, Svelte or Vue, so each takes about a second on app B's 13,000 keys and 9,000 files (68 MB), measured by `bench/refactor.mjs`.
  - **A command that changes or deletes acts only on evidence it can establish, and refuses, with the reason, where it cannot.** The text does not show scope or values, so where reach or ownership is uncertain, `rename` refuses and `check --fix` keeps the key; neither guesses.
  - A call site is `m.key`, `m?.key`, `m["key"]`, a per-key import's path and name (static, dynamic or destructured), or a use of the name that import binds. `m` is any local name an import of `m` binds, whatever the path, so a re-export through the app's own module counts, and so does `import * as` keys.js, and `messages.m` after `import * as messages` of messages.js.
  - Tests are sources here too: `find` shows their call sites, and `rename` changes them, so a renamed key's tests keep passing. Only `check` and `check --fix` set them aside, to judge what ships.
  - `grai find <key>` prints the key's line in each catalog, each call site, and each other place a source writes the name.
  - `grai rename <key> <new>` renames the key in every catalog and at every call site, then compiles. It changes nothing when any other place writes the name (an object key, a string, someone else's property), and names each, since only the author knows what it means. A new name another key has, ignoring case, or one a file that binds the key already uses, refuses it too. So does a read by a computed name that may reach the key (`name => m[name]()`), and a file that reaches the key through a name it also declares as a parameter or local (`function render(m)`), since which `m` each use reads is a matter of scope.
  - `grai check --fix` removes each key no source names, then checks. A key that a read by a computed name may reach stays, and the report names the read: `m[expr]`, also through a wrapper (`messages.m[expr]`, or `i18n.m[expr]` through the app's own module), `m` or a namespace import of messages.js used whole, or per-key modules loaded by a built path. A read's literal start narrows its reach only when the index is a template that starts with text, or text joined to one name (`"promo_" + season`); anything else, such as a choice, reaches every key. A key that is no key name, such as `sign-in`, stays too: the scan finds only names, so it cannot see `m["sign-in"]`, and the check reports the key as invalid, for `grai rename` to fix.
- **Every command that writes a catalog edits its text, and every other byte stays,** so a diff shows only the change:
  - `add`, `seed` and `merge` give a key the catalog has its new value in place, and add a new key after the last entry of its object, in that object's layout: its indent, line breaks and spacing. A catalog with no entries yet, or a new one, takes another catalog's layout;
  - a new key goes where the base catalog has it, so `seed` and `merge` keep the base's objects. `add` puts it in the deepest object whose key, then `_`, starts it (`cart_tax` in `cart`), at the same path in every catalog, making the objects a catalog lacks;
  - a rename changes the key's string, and keeps its place while its object's key, then `_`, still starts the new name; else the message moves to where `add` would put the new key;
  - a removal takes the entry with the separator before it, and an object it leaves empty goes too;
  - `import` writes new catalogs, an entry per line indented by a tab.

  The files are written all or none: each new text goes to a temporary file of the writer's own, created anew beside its file so that it overwrites nothing, and they are renamed into place once all are written. A file that then cannot be replaced, such as a path that is now a directory, has the files already replaced get back what they held, so a command that fails leaves every catalog as it was.
- Every command prints each error on its own line, sorted by file, key and locale, then how many, and exits with 1. A usage error exits with 2.

## Next.js

Next runs the proxy apart from the render, renders a request's layouts and pages side by side, and renders client components on the server in a module graph of their own. `grai/next` gives each of these the request's locale the way Next lets it, and a message call stays a plain function.

- **The proxy hands the locale over in the path.** `proxy` resolves it by the config's strategy, through the output's `middleware`, and rewrites the request to the same path under `/<locale>`; the pages live under `app/[locale]/`. Next's docs pass data from a proxy by the URL, headers or cookies, and the path is the one that keeps pages static: Next routes the locale as a segment, `generateStaticParams` renders each locale ahead of time, and `next/root-params` reads it anywhere. The URL stays as the strategy has it, so with `url` the base locale has no prefix, and a cookie or `Accept-Language` app has none at all.
- **A server component reads the locale from React's `cache`, which React keeps for one request's render.** Each page, layout and `generateMetadata` calls `bindLocale(locale)` with its param before any message. Measured in Next 16.4: a page and its `generateMetadata` start before the layout's `await params` returns, and a client navigation renders only the segments that change, so no single place can bind it for the others. A message before the binding throws a `GraiError` saying so, rather than rendering the base locale's words. The cache holds the request's `{ index }` record, which `setLocale` in the render changes in place.
- **Outside a render, a call names its locale** (`m.saved({}, { locale })`). React keeps no `cache` in server actions or route handlers (measured), and `next/root-params` does not reach them either.
- **A client component on the server reads the locale from React context.** Next renders client components in a module graph of their own, with no call an app could wrap in a scope, so `LocaleProvider`, in the root layout, gives the request's locale as context, and the dispatcher reads it with `use`. On the server a client component's code runs only while it renders, which is where `use` works. That record is read-only, and `setLocale` there throws: what a client component renders on the server must be what it hydrates with. Interleaved requests keep their own locales, in server and client components alike (`test/next.test.ts`).
- **In a browser the locale is the page's `<html lang>`, and the page keeps it.** Next keeps the root layout through a client navigation into another locale, since only the param's value changes. Once React has written the new `<html lang>`, `LocaleProvider` switches with `setLocale`, which loads that page: a mounted component, memoized by hand or by the React Compiler, would otherwise keep its old words. A page whose `<html lang>` is not its locale is never reloaded, so that mistake cannot loop.
- **`withGrai` points `grai/next/output/*` at the outdir in Turbopack and webpack,** so grai/next's modules bind the app's own runtime, one instance per layer Next bundles. Why Next resolves the output this way while SvelteKit takes it explicitly is below.
  - `next build` compiles and fails on any error.
  - `next dev` compiles only when the output is not current, so Next starts at once, then watches. Next asks for its config twice in one process, and the watch starts once.
  - Any other command, such as `next start`, bundles nothing, and gets the config as it is.
- **Per-key paths need nothing from the adapter:** package.json `imports` map them to keys.js in Turbopack, webpack and TypeScript alike.
- **A server component's messages send no code to the browser,** only the HTML they render. A client component's messages ship as their keys' functions with every locale's variants: one Next build serves every locale, and Next gives an adapter no way to point a page at one locale's chunks. Unused keys are left out by the bundler, so only the keys client code names ship (`docs/runtime.md`).
- **In dev, Turbopack watches the outdir.** An edit rewrites one shard in about 27 ms, 20 of them waiting for the save to settle, and Next's own refresh takes the rest.

**Why the Next adapter finds the output itself.** The SvelteKit adapter in review (#11), `handleLocale({ middleware, getTextDirection })`, takes the output's functions from the app's hook, and that is enough: Kit renders every component of a request inside that one hook, in one module graph. Next has a graph for server components, one for client components on the server and one for the browser, and the second is reached only through a `"use client"` module. A server component cannot hand that module the runtime, because only serializable props cross into a client component. Passing it explicitly would then take two glue files in every app, one for server components and one `"use client"`, each binding a runtime instance the adapter can bind itself. So `withGrai` resolves `grai/next/output/*` to the outdir in each bundler. That is the same mechanism next-intl's plugin uses for its request config, and it is the reason `grai/next` needs `withGrai` in `next.config`.

`grai/react`'s `Markup` draws a markup message's `.parts()` with the app's function for each element. It is React's, not Next's, so a React app on Vite uses it too, and it renders in server and client components alike. An element the message names and the app does not draw throws, naming it.

## Package

- **One package, `grai`.** A project installs one thing, and the adapters version with the compiler they wrap. Subpath exports, each added with its code:
  - `grai`: the compiler's API;
  - `grai/vite`: the Vite plugin; the SvelteKit adapter comes as `grai/sveltekit`, thin, taking the project's generated modules;
  - `grai/svelte`: the Vite plugin for a Svelte app, whose client build also reads a call without inputs as its string;
  - `grai/next`, `grai/next/config` and `grai/next/proxy`: the Next adapter, also thin, which finds the project's generated modules through `withGrai`;
  - `grai/react`: the `Markup` component;
  - the `grai` binary: the CLI.
- **No dependencies.** The generated output needs only the platform, and `AsyncLocalStorage` on the server. Each locale's text direction is worked out when grai compiles, so the runtime looks it up by index. The compiler needs only Node. Vite, Svelte, magic-string, Next and React are optional peer dependencies of the adapters that use them, as SvelteKit will be of its own.
