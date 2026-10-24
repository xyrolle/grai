# Design

grai compiles translation catalogs into plain functions and their type declarations. These are the decisions, each with its reason.

## Goals

The reference workloads are two production SvelteKit apps: app A with 6,379 keys × 3 locales (about 19k messages), and app B with 13,326 keys × 3 locales (about 40k messages).
- A full compile takes well under a second on either.
- An edit to one message reaches the output in milliseconds.
- No network, no plugins, and no TypeScript run.
- The browser gets only its own locale's words.

## Catalogs and config

- **Catalogs are the inlang message-format JSON, flat, one file per locale,** so existing Paraglide catalogs compile unchanged. `$schema` is ignored.
- **The constructs are a deliberate subset:**
  - text and `{name}` placeholders;
  - markup: `{#tag}…{/tag}` and `{#tag/}`, with options (`href=|/terms|`, `rel=$rel`) and attributes (`@translate=no`, `@hidden`);
  - variants: `declarations` (`input x`, `local y = x: plural`, `local y = x: plural type=ordinal`, and a `:number` or `:integer` local to select on), `selectors` and `match`, with `*`, several selectors, and `""` for a message without selectors;
  - formatting: `:number`, `:integer`, `:percent`, `:currency`, `:unit`, `:relativetime`, `:list`, `:datetime`, `:date` and `:time` with their options, in a placeholder (`{x :number}`) or as a local (`local y = x: number`);
  - the escapes `\{`, `\}` and `\\`.

  Anything else is a compile error that names the construct, rather than an approximation. That covers other functions such as `:string`, an option's value taken from an input other than a currency, a number's unit or a date's time zone (such as `:relativetime`'s `unit=$unit`), plural options other than `type`, selecting on a date or on a number its options round, and nested keys (`docs/followups.md`).
- **A key is a JavaScript identifier, unique ignoring case.** It is the export name, and the last segment of its per-key import path. On a case-insensitive file system, two such paths that differ only in case are one file.
- **Every key is in every locale.** A key missing from a locale is one compile error naming the locales that lack it and the `grai add` command that adds it to them. A missing translation would otherwise ship as a failed import or as another locale's words.
  - **A locale can fall back to another of its language,** with `"fallbacks": { "en-GB": "en" }`: a key its catalog lacks then compiles from the other's message, which costs nothing at run time, and its catalog can hold only the messages that differ, or none. Never to another language, as i18next allows, which would show that language's words, and never by tag alone, as Paraglide does, so a locale stays strict unless the config says otherwise. The base locale takes no fallback, as its catalog is where every key is declared.
- **The config is one JSON file, `grai.config.json`:** `locales`, `baseLocale`, `catalogs` (`"messages/{locale}.json"`), `outdir`, the server's `strategy` and `cookieName`, `switch`, `tests`, and `identicalToBase`. JSON is read without executing code, so the CLI, Vite and Next read the same file the same way.
- **Nothing is fetched and nothing is loaded from elsewhere.** grai's parser is the format's only reader, so a compile cannot depend on the network.

## Output layout

```
<outdir>/
  config.js                      the project's locales and strategy, which the runtime reads
  plurals.js                     each locale's plural rules, compiled from CLDR
  formats.js                     the Intl formatters messages call, when any does
  runtime.js    runtime.d.ts     the runtime, the same for every project
  server.js     server.d.ts      the request middleware; client code never imports it
  keys.js       keys.d.ts        every message, as the re-exports of its shards
  keys/<n>.js   keys/<n>.d.ts    a shard: about 512 keys
  keys/<n>.d.ts.map              its declarations' map to the keys in the base catalog
  messages.js   messages.d.ts    `m`, the namespace of keys.js
  .grai/manifest.json            what the output was compiled from, and its files
```

- **On disk, a few modules hold every message.** Node, scripts and tests load them as they are, and the output is a few dozen files whatever the key count. Per-key files would cost every install, editor index and file watcher, two files a key: 26.7k for app B.
- **The keys are split into shards by a hash of their name**, a power of two of them so that a key moves only when the key count doubles. An edit then rewrites one shard of about 512 keys, and its declarations only when they change, not the whole catalog's output. TypeScript and editors re-read that shard alone.
- **Per-key import paths map to keys.js with one line, never a file per key.** An app that imports `import { key } from "…/messages/key.js"` maps the pattern in its package.json `imports` (`"#i18n/messages/*": "./src/lib/i18n/keys.js"`). Node and TypeScript resolve every key's path to keys.js and its declarations, and a key that does not exist is a type error at the import. The Vite adapter resolves the same paths itself.
- **A production build splits by key, from memory.** Measured with Vite 8.3 (Rolldown) and Rollup 4.52, on two entries that use two keys each, one key shared:
  - one module of keys: static member access on its namespace drops the unused keys, but every key used anywhere lands in one shared chunk, so each route carries the others' words;
  - one module per key: each entry's chunk carries only its own keys, and the shared key gets a chunk of its own.

  So the Vite adapter builds one module per key from the compiler's model, and `keys.js` and the per-key paths resolve to them. They are never files, and the adapter's build test pins both results.
- **Dev serves one module.** A dev page then requests every message as one module, whatever the key count, and every per-key path resolves to that same module. A missing key's path resolves to a module whose one export throws a `GraiError` naming the key when called, and the plugin reports the key in the overlay. The import itself succeeds, because a failed import would set off Kit's stale-deployment reload. This module is not built yet (`docs/followups.md`).
- **The per-locale variants of the message modules exist only in memory too.** They have the same exports, with one locale's function each, and the bundler adapters build them from the compiler's model.
- **The output brings its own runtime.** `runtime.js` is the package's runtime module, as it is, beside the `config.js` it reads. The output imports nothing from `grai`, so it runs wherever the app's code runs: a Worker, a script, or a server bundle that leaves out its dependencies.

### The browser's locale

The server picks the page's locale. The client's locale is the page's `<html lang>`, which the server writes, so the page hydrates in the words it was drawn in. A production client build loads only that locale's variants of the message modules it uses.

They come through an import map, which keeps the framework's single client build (`docs/runtime.md`):
- **The Vite plugin puts the key modules in chunks of their own,** by the entries that use them, under a directory `grai` beside the one the bundler would have used (Kit's `_app/immutable/chunks/` gives `_app/immutable/grai/`). The runtime has a chunk of its own, so a message chunk holds keys and nothing else.
- **Each message chunk has a copy per locale,** under the sibling `grai-<locale>/`, with the same file name, imports and exports. Each key's call keeps only its locale's variant, at its locale's position, so the runtime picks it for the page's locale. A sibling, not a subdirectory, so the copies' relative imports reach the same shared chunks.
- **The server writes the import map,** from `…/grai/` to `…/grai-<locale>/`, and points the page's `modulepreload` links at the copies, as browsers apply no import map to `modulepreload`. Without the map a page still works, with every locale's words. This is the SvelteKit adapter's part, still open (`docs/followups.md`).

**Every client rule is the same in every build, dev and tests included, so nothing fails only after deploy.** On the client, a forced `{ locale }` must be the current locale. Any other throws a `GraiError` (`locale-not-loaded`) naming both locales, and in dev the key too. A build leaves key names out of the page: on app A they would add a third to its gzipped message bytes, and the call site in the stack names the key.

### A Svelte component reads a message without inputs as its string

`grai/svelte`'s plugin is `grai/vite`'s, and in the client build it also rewrites each component: a call of a text key with no arguments, `{m.title()}`, or `{title()}` of the key's own import, becomes a read of that key's string in the page's locale. The string comes from a module of its own (`grai:text/title`), whose `pageText(…)` picks the page's locale once, as the module is evaluated.
- **Svelte draws an imported value as plain, and treats a call as possibly stateful.** It gives each message call a derived signal and runs it as the page hydrates; a string it sets once. On a page of 2,000 calls with app A's catalog, built by Vite through both plugins, the strings hydrate in 16.6 ms against 24.6 ms for the calls at a 4× CPU slowdown, two-thirds of the way to text inlined into the template (12.7 ms, `svelte-texts`).
- **Inlining the text into the template would close the rest,** but every component would be built once per locale.
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
	(i) => (plural_en(i.count) === "one" ? `${i.count} item` : `${i.count} items`),
	(i) => `${i.count} Artikel`,
);
```

- **One plain function per locale, in `locales` order.**
  - `message` returns `(inputs, options) => variants[index of (options?.locale ?? the bound locale)](inputs)`: one shared dispatcher, not a copy per key.
  - A message without inputs is a string per locale (`text`).
  - One locale may use a plain pattern where another selects: the German above needs no plural.
- **A message with markup also has `.parts()`**, built the same way. A part is `{ type: "text", value }` or `{ type: "markup-start" | "markup-end" | "markup-standalone", name, options, attributes }`. An option is a literal, or the value of an input or local (a formatted local as its text); an attribute is a literal, or `true` when it has none. The app then decides how markup looks, and translators decide where it stands.
- **Inputs are read as `i.name`, not `i?.name`.** The types require them, and the body is repeated in every message function (40k in app B).
- **A server build writes each locale's function as a function expression, `function (i) { return … }`.** V8 parses every arrow function of a module in full when it loads the module, but only pre-parses a function expression, until its first call. A server loads every locale's functions and a request calls few of them, so the Vite plugin's server build loads app A's messages about a fifth faster (`docs/runtime.md`). The browser's modules and `keys.js` keep arrows, which are shorter.
- **Each locale's function is a pure arrow of its inputs, and that is what makes a message inlinable.** It reads nothing but its inputs and its locale's plural and format functions. An opt-in bundler transform, later, can then replace a call in a per-locale build (`docs/runtime.md`):
  - with the string, for a message without inputs;
  - with the body, when the argument is an object literal of side-effect-free values, each read once;
  - with a direct call of the locale's arrow, otherwise.

  There is then no dispatch and no call, and a key no call site names is never emitted. The transform gets the arrows from the compiler's model, not by parsing output. A message used as a value (`label: m.cart_title`) stays a function.

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
- **An input's type is the narrowest that every locale accepts:**
  - `number` where any locale counts it with `:plural` or formats it as a number, and `Date | number` where one formats it as a date;
  - the union of the keys, as numbers and strings (`1 | "1" | …`), where every locale that selects on it lists its values without `*`;
  - `string` where it gives a formatter an option, such as `currency=$code`;
  - `NonNullable<unknown>` where it is only interpolated or selected with `*`, because interpolation turns any value into text.

  A key's inputs are the union over its locales, so a call suits every locale.
- **The doc comment is the base locale's text**, so an editor shows the words at the call site.
- **Go to definition lands on the key in the base locale's catalog.** Each shard's declarations have a declaration map, from each key's name to the line its key is on in the base catalog, and TypeScript 6's tsserver and TypeScript 7's language server both follow it. An edit regenerates the maps only when it moves a key to another line, so a message's new words cost no map.
- **The output's JavaScript type-checks too**, under `checkJs` with `strict`, as an app with it in `src` checks it. `runtime.d.ts` declares what the shards and `server.js` import from the runtime, and `config.js` and `plurals.js` carry JSDoc types.
- **The declarations are sharded like the modules.** One file loads a little faster in an editor the first time, but an edit rewrites it whole, so every edit after costs more. A file per key costs the most in `tsc` and in completion alike.

## Selection: plurals and selects

These are MessageFormat 2's rules, restricted to the constructs above:

- **`local n = count: plural` selects the CLDR cardinal category of `count`** for the message's locale, through a function compiled from CLDR's rules for that locale alone. A whole, non-negative count, the usual one, takes a path with the fraction operands folded away; any other count is rounded to three fraction digits first, as `Intl.PluralRules` rounds it. That is 4–11 ns a call against 124–249 ns for a cached `Intl.PluralRules` (`plurals`), and every locale agrees with `Intl.PluralRules` on 0–10,000, on fractions and on negative counts. The rules are CLDR 48's, from the `cldr-core` package, so a project's categories are the same on every engine; the compile checks the variants against them.
- **`local n = count: plural type=ordinal` selects the CLDR ordinal category of `count`** (`one` for 1st, 21st, `two` for 2nd in `en`), compiled from CLDR's ordinal rules the same way, and Paraglide's `plural` takes the same option. Every locale agrees with `Intl.PluralRules` of type ordinal on 0–1,000 and on fractions. A language whose every count is `other`, as 66 of CLDR's 108 rank (`ru`, `de`) and 34 of its 224 count (`ja`, `zh`), gets a function that returns it without reading the count, so a bundle of it carries no operands.
- **A `:number`, `:integer` or `:percent` local selects as MessageFormat 2's `:number` does.** A key that is a number matches a value equal to it, and a key that is a category matches the value's category: cardinal by default, ordinal with `select=ordinal`, and none with `select=exact`. An exact match comes before a category, so `n=1` is chosen for 1 over `n=one`. `:integer` rounds the value half away from zero first, as it shows it.
  - A key is compared with the value as JavaScript writes the number, which is MessageFormat 2's serialization for a whole number. So `1.0` and `01` can never match, and they are compile errors, as is a fraction under `:integer`.
  - A local whose options change its digits (`maximumFractionDigits`, significant digits, rounding, `notation`, `style`) is refused as a selector: MessageFormat 2 selects on the number those digits show, which a compiled rule cannot read. `signDisplay`, `useGrouping` and `numberingSystem` only change how it is written, and are taken.
  - `:percent` selects the same way, always by the cardinal rules, on the percent it shows. 0.29 is 29: the decimal point is moved two places, where `0.29 * 100` is 28.999999999999996.
  - A currency, a unit, a date or a time does not select, in MessageFormat 2 or in grai.
- **A selector on an input matches a key when `String(value)` equals it.** That is MessageFormat 2's string selection, so `1` and `"1"` both match the key `1`.
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
- **An option the app's data decides can come from an input: `currency=$code`, `unit=$unit` and `timeZone=$zone`.** Which currency an amount is in, or which time zone a reader is in, is data. How the value looks, its style and its fields, is the message's to write, so those options stay literal and are checked when compiling.
  - The compile checks such a call with a value the option takes, so the literal options around it are still checked. A currency needs `style=currency` written beside it, and a unit `style=unit`, or Intl would leave them out. So a call takes one option from an input at most.
  - The input is typed `string`. A value Intl refuses throws a `GraiError` with the code `format-option-invalid`, which names the option and the value.
  - Each value gets its own formatter, made the first time it formats and kept in a map. A number formats in 216–305 ns with its currency from an input, against 205–248 ns with it written; Paraglide, which finds a formatter by the options each call builds, takes 688–1,054 ns (`option-inputs`).
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
  - An edited catalog laid out one entry per line, as editors and formatters write them, has a line break and the same indent before each top-level key and nowhere else, because a JSON string holds no raw line break. The edit's changed bytes lie between two such entry starts, so only that span is parsed, in the old file and in the new. Whenever that cannot be shown exactly (another layout, a duplicated key, a span that does not parse), the whole file is parsed instead.
  - Only the keys whose messages changed are compiled, and only their shards are rendered and written.
  - A failed recompile leaves the last good build as it was, so the next one starts from it.
- **Watching covers the config and the catalog files, nothing else.** No other file can start a compile, so a framework's generated files never trigger one.
  - Each file is watched as a file, not through its directory, whose events macOS reports late.
  - The watches are set up again before each compile, so a file an editor saves by renaming another over it is seen, and so is a change during the compile.
  - A catalog that does not exist yet is watched for through its directory.
- **Each file is written to a temporary file in `.grai/` and renamed over the old one**, which is atomic on POSIX file systems. A reader sees the old file or the new one, never part of one. A file whose content is already there is not written, so file watchers, Vite's caches and TypeScript's incremental state stay warm.
- **The writes go in dependency order, a level at a time, each level's files at once:** `config.js` and the runtime first, then the shards, then `keys.js`, then `messages.js`, then any file no longer output, and the manifest last. At every instant, every import in the output resolves to a whole file, so no tool has to wait for the output or check it for a partial write.
- **One writer per outdir.** The writer takes a lock: a file holding its pid, linked into place so that it never exists empty. A lock whose process is gone is taken over, and a live one is waited for. The CLI's `watch` and the Vite plugin can then share an outdir.
- **In dev, the Vite plugin serves from memory and sends HMR itself.** It watches the config and the catalogs with `fs.watch` (3–10 ms to see a save, against 48–114 ms for Vite's watcher: `hmr`) and ignores every other file, and the output directory's changes are its own, so a compile is never reported twice. The plugin still writes the files, for TypeScript and editors.
- **An edit patches the page in place.** The dev module keeps every key's locales in a table. After an edit the plugin sends only the changed keys' functions, as a module the page imports; the page writes them into the table and dispatches a cancelable `grai:change` event on `window`. A framework adapter that renders again cancels it; otherwise the page reloads. The server's dev render takes the same patch, so an edit never evaluates the app again. A key added or removed, or a change of locales, reloads the page, and the server's environments take the module again. It is 17–30 ms from the save to the page, against 202–459 ms for re-sending the whole module (`hmr`).

## Runtime

The locale is resolved once per request on the server, or once per page on the client. A message call reads that bound value and never runs a strategy.

- **On the server, `server.js`'s middleware resolves the locale and binds it** to the request through `AsyncLocalStorage`. Its strategies:
  - `cookie`;
  - `preferredLanguage` (`Accept-Language`);
  - `url`: a non-base locale is the first path segment, and the base locale has no prefix. A locale's home page is `/de`, not `/de/`, which SvelteKit and Next would redirect to drop the slash; every other path keeps the slash the app wrote.

  The base locale is always the last resort, so the config does not list it. `url` can only come last: every path names a locale, the base locale's when it has no prefix, so the config rejects a strategy after it, which would never be read.
- **The middleware's response lists in `Vary` the request headers its strategy reads:** `Cookie` for `cookie`, `Accept-Language` for `preferredLanguage`, and none for `url` or for the strategies after it, which it never reads. A shared cache then keeps a copy per locale, not one locale's page for every reader. They are appended to the handler's own `Vary` without reading it first, which would cost every request a header read: a header listed twice means the same to a cache. A response from `fetch()` has immutable headers, and no platform can say so in advance, so such a response is copied.
- **A call reads the bound locale once and indexes its variant with it:** the request keeps the locale's position in `locales`, so there is no search and no strategy per call. `setLocale` in a request changes the locale for the rest of that request, and for no other: it writes the state the middleware binds for the request, as Workers have no `AsyncLocalStorage.enterWith` to bind a new one.
- **On the server outside a request** (scripts, crons, Node tests), one process-wide value is bound. It starts as the base locale, and `setLocale(locale, { reload: false })` changes it.
- **On the client,** the page's `<html lang>` is the locale, else the base locale. `setLocale(locale)` writes the cookie (`cookie`) or goes to the localized URL (`url`), and reloads. With `{ reload: false }` it switches in the page, which holds every locale until an adapter builds one locale per page; what it does then is the open question above.

The runtime's names are the ones existing Paraglide call sites use, so migrating changes imports, not calls. Only the middleware has a name of its own:
- `runtime.js`: `getLocale`, `setLocale`, `locales`, `baseLocale`, `Locale`, `isLocale`, `assertIsLocale`, `cookieName`, `getTextDirection`, `MessagePart`;
- for the `url` strategy: `localizeHref`, `localizeUrl`, `deLocalizeUrl`, `extractLocaleFromUrl`. Without it they leave every URL as it is, since no URL then names a locale: in an app that keeps the locale in a cookie, `/de/…` is a path of its own, and a prefix would lead to a page it does not have;
- `server.js`: `middleware(request, ({ request, locale }) => response)`.

## Servers

- **One middleware serves every runtime, with no adapter.** It takes a `Request` and a handler and gives back the handler's `Response`: the shape of a fetch handler on Workers, Bun and Deno, and of Hono's middleware in one line, `(c, next) => middleware(c.req.raw, () => next().then(() => c.res))`. An adapter would add a name and no behaviour.
- **On Workers it needs only `AsyncLocalStorage`.** Workers have it by default from compatibility date 2026-08-04, with the rest of Node.js compatibility. On an earlier date the `nodejs_als` flag adds it alone, and without it the Worker does not start: `No such module "node:async_hooks"`. `test/workers.test.ts` runs the example under the default, and its interleaving Worker with `nodejs_als` alone.
- **A request's locale holds across its awaits in workerd, Bun and Deno, as in Node.** In the test, 30 requests in three locales are all in flight at once in each runtime, and each renders again after an await in its own locale, or in the one its `setLocale` chose.
- **The tests get Bun and Deno from pnpm's runtime protocol** (`"bun": "runtime:1.4.4"` in the devDependencies), as they get workerd from Wrangler: one `pnpm install` brings every runtime they serve the example in, at a pinned version, with nothing installed globally.

## CLI

- `grai compile` writes the output once; `grai watch` keeps it current, incrementally.
- `grai check` runs every compile check (lockstep, plural categories) without writing, and adds two of its own:
  - keys no shipped source file names. A key counts as named when it is an identifier anywhere in a JavaScript, TypeScript, Svelte or Vue file under the project, or under `--source`, outside dependencies, build output and the outdir. That counts `m.key` and per-key imports alike, and never calls a key unused that shipped code names;
    - **a test ships nothing, so a key that only tests name is unused,** and the report names those tests, which must change with it. Tests are the files the config's `tests` globs match, by path from the root: by default Vitest's and Jest's names (`*.test.*`, `*.spec.*`), Jest's `__tests__` folders, and the root's `test` and `tests`. A folder named `tests` deeper down may ship, as a SvelteKit route at `src/routes/tests/` does, and calling its keys unused would have `--fix` delete them. `[]` makes no file a test;
  - inputs one locale reads and another never does, which is a translation that lost or invented a placeholder.

  It also lists, per locale, the keys still untranslated: those whose message equals its seed, but the keys `identicalToBase` lists. This is a report, not an error, since a text can rightly read as the base locale's. `--json` prints the problems and the untranslated keys for scripts.
- `grai seed <locale>` gives a locale's catalog the base text of every key it lacks, and creates the catalog if there is none.
  - **Every key is in every locale, so an untranslated message is a seed, and equality to it is the marker.** Nothing is kept beside the catalogs.
  - **A message that rightly reads as the base text is listed in the config, under its locale in `identicalToBase`.** The report proved noisy without it: on app B it named 319 messages in one locale and 108 in another, each equal to the base on purpose (units, codes, words both languages share).
    - The list is in the config, not in a file beside the catalogs or as markers in them, so the catalogs stay the inlang format and every exception is in one reviewed place.
    - `check` and `export` take a listed key as translated, and `check` reports one that no catalog has or whose message is no longer the base text. A stale entry would otherwise hide a key that needs translating.
    - `rename` and `check --fix` change the list with the key, through the catalogs' one writer: only the list is written again, in the config's layout, and every other byte of the config stays.
  - A seeded plural keeps the variants the locale can choose, and its `other` becomes `*` when it has no `*`. It then compiles in a locale with more categories, such as `few` in `ru`.
- `grai export <locale>` prints a locale's messages for translators, or only the untranslated ones. `grai merge <file>` writes the translations back into the locale's catalog.
  - **The file is XLIFF 2.0**, the OASIS standard translation tools exchange, and both Weblate and Phrase read it.
    - A placeholder is a `<ph>`, and a pair of tags is a `<pc>` around its words, so a tool keeps a translator from breaking either.
    - CSV, which every tool also reads, holds placeholders as text a translator can mistype, and has no plurals.
    - `--json` writes the same units for scripts, with each code as the catalog writes it, since Node reads no XML.
  - **A plural is one unit per category of the target locale,** each with a note of the counts it is for.
    - Each starts from the base text for the same counts. For `ru`'s `one` (1, 21, 31…), English gives both `one` and `other`, so the unit starts from `other`, which shows the count.
    - A translation may place any code of its message.
    - A row that does not tell counts apart, such as `count=0`, stays one unit.
  - **`merge` refuses a unit, never the file.** A unit made from a base text that has changed since is stale, and one that places a code its message lacks is invalid.
    - A message must still compile and read the base's inputs. A plural needs every form, from the file or from its current translation.
    - A message no unit changes is left as it is written, and the rest go to the catalog in one write.
  - **Machine translation is not grai's.** grai fetches nothing, and a provider, its key, its prompts and a glossary are each app's choice. A script exports `--json`, translates, and merges, and the merge's checks refuse an answer that breaks a placeholder or a plural.
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
  - **What grai cannot express is left out, never approximated:** an ICU currency or skeleton style, `offset`, a format a project adds to i18next, nested values, and `$t()` with options or of a message with inputs. `$t(key)` of a text is inlined.
  - **One difference is reported, not left out:** an i18next plural that lacks a locale's form shows its `_other` text, where i18next showed the key's name.
  - `bench/import-equivalence.mjs` renders every imported message with grai and with i18next or intl-messageformat, for each locale and a range of inputs, and fails on any difference the report does not name. The libraries are the bench's dependencies, not grai's.
- **`find`, `rename` and `check --fix` read the sources through check's scan:** the same files, and the same notion of a name a source writes. None parses JavaScript, Svelte or Vue, so each takes about a second on app B's 13,000 keys and 9,000 files (68 MB), measured by `bench/refactor.mjs`.
  - A call site is `m.key`, `m?.key`, `m["key"]`, a per-key import's path and name (static, dynamic or destructured), or a use of the name that import binds. `m` is any local name an import of `m` binds, whatever the path, so a re-export through the app's own module counts, and so does `import * as` keys.js.
  - Tests are sources here too: `find` shows their call sites, and `rename` changes them, so a renamed key's tests keep passing. Only `check` and `check --fix` set them aside, to judge what ships.
  - `grai find <key>` prints the key's line in each catalog, each call site, and each other place a source writes the name.
  - `grai rename <key> <new>` renames the key in every catalog and at every call site, then compiles. It changes nothing when any other place writes the name (an object key, a string, someone else's property), and names each, since only the author knows what it means. A new name another key has, ignoring case, or one a file that binds the key already uses, refuses it too.
  - `grai check --fix` removes each key no source names, then checks. A key that a read by a computed name may reach stays, and the report names the read: `m[expr]`, narrowed by a template's or a concatenation's literal start, `m` used whole (`Object.keys(m)`, `typeof m`), or per-key modules loaded by a built path. A key that is no key name, such as `sign-in`, stays too: the scan finds only names, so it cannot see `m["sign-in"]`, and the check reports the key as invalid, for `grai rename` to fix.
- **Every command that writes a catalog edits its text, and every other byte stays,** so a diff shows only the change:
  - `add`, `seed` and `merge` give a key the catalog has its new value in place, and add a new key after the last entry, in the catalog's own layout: its indent, line breaks and spacing. A catalog with no entries yet, or a new one, takes another catalog's layout;
  - a rename changes the key's string, and a removal takes the entry with the separator before it;
  - `import` writes new catalogs, an entry per line indented by a tab.

  The files are written all or none: each new text goes to a temporary file first, and they are renamed into place once all are written.
- Every command prints each error on its own line, sorted by file, key and locale, then how many, and exits with 1. A usage error exits with 2.

## Package

- **One package, `grai`.** A project installs one thing, and the adapters version with the compiler they wrap. Subpath exports, each added with its code:
  - `grai`: the compiler's API;
  - `grai/vite`: the Vite plugin; the SvelteKit and Next adapters come as `grai/sveltekit` and `grai/next`, each thin, each taking the project's generated modules;
  - the `grai` binary: the CLI.
- **No dependencies.** The generated output needs only the platform, and `AsyncLocalStorage` on the server. Each locale's text direction is worked out when grai compiles, so the runtime looks it up by index. The compiler needs only Node. Vite is an optional peer dependency of `grai/vite`, as each framework will be of its adapter.
