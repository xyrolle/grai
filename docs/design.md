# Design

grai compiles translation catalogs into plain functions and their type declarations. These are the decisions, each with its reason.

## Goals

The reference workloads are two production SvelteKit apps: app A with 6,366 keys × 3 locales (about 19k messages), and app B with 13,326 keys × 3 locales (about 40k messages).
- A full compile takes well under a second on either.
- An edit to one message reaches the output in milliseconds.
- No network, no plugins, and no TypeScript run.
- The browser gets only its own locale's words.

## Catalogs and config

- **Catalogs are the inlang message-format JSON, flat, one file per locale,** so existing Paraglide catalogs compile unchanged. `$schema` is ignored.
- **The constructs are a deliberate subset:**
  - text and `{name}` placeholders;
  - markup: `{#tag}…{/tag}` and `{#tag/}`;
  - variants: `declarations` (`input x`, `local y = x: plural`), `selectors` and `match`, with `*`, several selectors, and `""` for a message without selectors;
  - the escapes `\{`, `\}` and `\\`.

  Anything else is a compile error that names the construct, rather than an approximation. That covers other functions such as `:number` and `:datetime`, options, nested keys, and markup options and attributes (`docs/followups.md`).
- **A key is a JavaScript identifier, unique ignoring case.** It is the export name, and the last segment of its per-key import path. On a case-insensitive file system, two such paths that differ only in case are one file.
- **Every key is in every locale.** A key missing from a locale is a compile error naming the locales that lack it. A missing translation would otherwise ship as a failed import or as another locale's words.
- **The config is one JSON file, `grai.config.json`:** `locales`, `baseLocale`, `catalogs` (`"messages/{locale}.json"`), `outdir`, and the server's `strategy` and `cookieName`. JSON is read without executing code, so the CLI, Vite and Next read the same file the same way.
- **Nothing is fetched and nothing is loaded from elsewhere.** grai's parser is the format's only reader, so a compile cannot depend on the network.

## Output layout

```
<outdir>/
  config.js                      the project's locales and strategy, which the runtime reads
  plurals.js                     each locale's plural rules, compiled from CLDR
  runtime.js    runtime.d.ts     the runtime, the same for every project
  server.js     server.d.ts      the request middleware; client code never imports it
  keys.js       keys.d.ts        every message, as the re-exports of its shards
  keys/<n>.js   keys/<n>.d.ts    a shard: about 512 keys
  messages.js   messages.d.ts    `m`, the namespace of keys.js
  .grai/manifest.json            what the output was compiled from, and its files
```

- **On disk, a few modules hold every message.** Node, scripts and tests load them as they are, and the output is a few dozen files whatever the key count. Per-key files would cost every install, editor index and file watcher, at 12.7k files for app A and 26.7k for app B, and writing that many takes about a second on its own (measured: 26.7k small files, 0.75 to 1.3 s).
- **The keys are split into shards by a hash of their name**, a power of two of them so that a key moves only when the key count doubles. An edit then rewrites one shard of about 512 keys (100 kB for app B), and its declarations only when they change, not the whole catalog's output. TypeScript and editors re-read that shard alone.
- **Per-key import paths map to keys.js with one line, never a file per key.** An app that imports `import { key } from "…/messages/key.js"` maps the pattern in its package.json `imports` (`"#i18n/messages/*": "./src/lib/i18n/keys.js"`). Node and TypeScript resolve every key's path to keys.js and its declarations, and a key that does not exist is a type error at the import. The Vite adapter resolves the same paths itself.
- **A production build splits by key, from memory.** Measured with Vite 8.3 (Rolldown) and Rollup 4.52, on two entries that use two keys each, one key shared:
  - one module of keys: static member access on its namespace drops the unused keys, but every key used anywhere lands in one shared chunk, so each route carries the others' words;
  - one module per key: each entry's chunk carries only its own keys, and the shared key gets a chunk of its own.

  So the Vite adapter builds one module per key from the compiler's model, and `keys.js` and the per-key paths resolve to them. They are never files, and the adapter's build test pins both results.
- **Dev serves one module.** A dev page then requests every message as one module, whatever the key count, and every per-key path resolves to that same module. A missing key's path resolves to a module whose one export throws a `GraiError` naming the key when called, and the plugin reports the key in the overlay. The import itself succeeds, because a failed import would set off Kit's stale-deployment reload.
- **The per-locale variants of the message modules exist only in memory too.** They have the same exports, with one locale's function each, and the bundler adapters build them from the compiler's model.
- **The output brings its own runtime.** `runtime.js` is the package's runtime module, as it is, beside the `config.js` it reads. The output imports nothing from `grai`, so it runs wherever the app's code runs: a Worker, a script, or a server bundle that leaves out its dependencies.

### The browser's locale

The server picks the page's locale. The client's locale is the page's `<html lang>`, which the server writes, so the page hydrates in the words it was drawn in. A production client build loads only that locale's variants of the message modules it uses.

Which mechanism delivers them is chosen by measurement in `bench/`. The candidates:
- the same chunk names in a directory per locale, with an import map written by the server;
- a build per locale;
- strings inlined per locale.

The compiler commits to what every candidate needs: locale-free per-key modules and per-locale variants.

**Every client rule is the same in every build, dev and tests included, so nothing fails only after deploy.** On the client, a forced `{ locale }` must be the current locale. Any other throws a `GraiError` naming the key and both locales.

### Switching locale on the client: open

Tests switch the locale within the page, and so do many apps, without a reload. A production page holds only its locale's words. Two designs keep the behaviour the same in every build, and `bench/` measures (a) before one is picked:

- **(a) Load, then switch.** `setLocale(locale, { reload: false })` imports the target locale's variants of the message modules the page holds, then switches, and the app re-renders.
  - In that mode it returns a promise that settles once the switch is done.
  - `setLocale(locale)` keeps reloading and returns nothing.
  - In dev and tests, where every locale is loaded, the promise settles at once.
  - The adapters must know which message modules a page holds.
- **(b) No switch within the page, in any build.** `setLocale` always reloads or navigates. Tests switch through a test-only entry (`grai/testing`), which a production build cannot import.

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
- **A message with markup also has `.parts()`**, built the same way. A part is `{ type: "text", value }` or `{ type: "markup-start" | "markup-end" | "markup-standalone", name, options: {}, attributes: {} }`. The app then decides how markup looks, and translators decide where it stands.
- **Inputs are read as `i.name`, not `i?.name`.** The types require them, and the body is repeated in every message function (40k in app B).
- **Each locale's function is a pure arrow of its inputs, and that is what makes a message inlinable.** It reads nothing but its inputs and its locale's plural function. A bundler transform in a per-locale build replaces a call:
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

- **The compiler writes the `.d.ts` files itself, as text, from the same model as the JavaScript.** It never runs TypeScript. Declaration emit through TypeScript takes most of a compile at this catalog size (27 s of 32 s on app A), and writing the declarations directly takes milliseconds.
- **The types are named in the generated `runtime.d.ts`:**
  - `Locale` is the union of the locales.
  - `Message<I>` is `(inputs: I, options?: { locale?: Locale }) => string`.
  - A message without inputs takes `inputs?: Record<string, never>`.
  - `MarkupMessage<I>` adds `.parts(): MessagePart[]`.
  - Messages return `string`.
- **An input's type is the narrowest that every locale accepts:**
  - `number` where any locale counts it with `:plural`;
  - the union of the keys, as numbers and strings (`1 | "1" | …`), where every locale that selects on it lists its values without `*`;
  - `NonNullable<unknown>` where it is only interpolated or selected with `*`, because interpolation turns any value into text.

  A key's inputs are the union over its locales, so a call suits every locale.
- **The doc comment is the base locale's text**, so an editor shows the words at the call site.
- **The declarations are sharded like the modules, by measurement.** On app A and app B, a file importing `m` and using five keys, checked with TypeScript 7 and completed after `m.` with TypeScript 6's language service:

  | Layout | `tsc` | `m.` completion, first | after a one-message edit |
  | --- | --- | --- | --- |
  | shards (grai) | 240 / 250 ms | 300 / 440 ms | 56 / 120 ms |
  | one file | 215 / 250 ms | 185 / 330 ms | 89 / 190 ms |
  | a file per key | 400 / 960 ms | 810 / 2,010 ms | 270 / 1,890 ms |

  One file is a little faster to load the first time, but an edit rewrites it whole, so every edit costs more after. A file per key costs the most everywhere.

## Selection: plurals and selects

These are MessageFormat 2's rules, restricted to the constructs above:

- **`local n = count: plural` selects the CLDR cardinal category of `count`** for the message's locale, through a function compiled from CLDR's rules for that locale alone. A whole, non-negative count, the usual one, takes a path with the fraction operands folded away; any other count is rounded to three fraction digits first, as `Intl.PluralRules` rounds it. That is 4–11 ns a call against 124–249 ns for a cached `Intl.PluralRules` (`docs/runtime.md`), and every locale agrees with `Intl.PluralRules` on 0–10,000, on fractions and on negative counts. The rules are CLDR 48's, from the `cldr-core` package, so a project's categories are the same on every engine; the compile checks the variants against them.
- **A selector on an input matches a key when `String(value)` equals it.** That is MessageFormat 2's string selection, so `1` and `"1"` both match the key `1`.
- **The variant is chosen by MessageFormat 2's preference:** among the variants whose every key matches, a literal key comes before `*`, selector by selector, and then the order written.
- **A selection must be exhaustive, or it is a compile error:**
  - every plural selector covers every CLDR category of its locale, or has `*`, and every combination is covered when there are several;
  - a key that is not a category of the locale (`few` in `en`) is an error, because it can never be chosen.

  An uncovered count would otherwise render the key's name. Both reference catalogs already meet this rule.
- **A select on an input without `*`** (`month=1` … `month=12`) is closed by its type. A value outside it at run time throws a `GraiError` naming the key, the locale and the value.

## Errors

- **Every failure is a `GraiError`** with a `code`, the `file`, and the `key` and `locale` where they apply. Its message says what is wrong and what to do: for example, `messages/pl.json: "cart_items" (pl): the plural selector countPlural has no variant for "many". Add countPlural=many, or countPlural=*.`
- **A compile reports every error at once, sorted by file, key and locale, and exits non-zero.** It leaves the last good output in place, and the Vite plugin shows the errors in the overlay while the last good output keeps serving.
- **Anything grai needs that it cannot read or parse is an error that names it:**
  - the config file, a field of it, a configured locale's catalog, or a catalog that is not JSON;
  - a catalog with no messages, which is an error for its locale.

  A compile never succeeds with fewer locales or messages than configured, and each of these cases has a test.

## Incremental compiles and atomic output

- **A compile reads the catalogs as bytes and hashes them first.** When the manifest says the output was compiled from the same config and bytes by the same runtime, and every file it lists is there, the compile stops: nothing is parsed and no file is touched.
- **A recompile after an edit redoes only what the edit changed.** It keeps the last build in memory: each catalog's bytes and parse, each key's compiled code, each shard's text.
  - A catalog whose bytes are the same is not parsed again.
  - An edited catalog laid out one entry per line, as editors and formatters write them, has a line break and the same indent before each top-level key and nowhere else, because a JSON string holds no raw line break. The edit's changed bytes lie between two such entry starts, so only that span is parsed, in the old file and in the new. Whenever that cannot be shown exactly (another layout, a duplicated key, a span that does not parse), the whole file is parsed instead.
  - Only the keys whose messages changed are compiled, and only their shards are rendered and written.
  - A failed recompile leaves the last good build as it was, so the next one starts from it.
- **Watching covers the config and the catalog files, nothing else.** No other file can start a compile, so a framework's generated files never trigger one.
  - Each file is watched as a file, not through its directory: on macOS a directory's events arrive about 11 ms late, a file's in 0.2 ms.
  - The watches are set up again before each compile, so a file an editor saves by renaming another over it is seen, and so is a change during the compile.
  - A catalog that does not exist yet is watched for through its directory.
- **Each file is written to a temporary file in `.grai/` and renamed over the old one**, which is atomic on POSIX file systems. A reader sees the old file or the new one, never part of one. A file whose content is already there is not written, so file watchers, Vite's caches and TypeScript's incremental state stay warm.
- **The writes go in dependency order, a level at a time, each level's files at once:** `config.js` and the runtime first, then the shards, then `keys.js`, then `messages.js`, then any file no longer output, and the manifest last. At every instant, every import in the output resolves to a whole file, so no tool has to wait for the output or check it for a partial write.
- **One writer per outdir.** The writer takes a lock: a file holding its pid, linked into place so that it never exists empty. A lock whose process is gone is taken over, and a live one is waited for. The CLI's `watch` and the Vite plugin can then share an outdir.
- **In dev, the Vite plugin serves from memory and sends HMR itself.** Vite does not watch the output directory, so a compile is never reported twice. The plugin still writes the files, for TypeScript and editors.

## Runtime

The locale is resolved once per request on the server, or once per page on the client. A message call reads that bound value and never runs a strategy.

- **On the server, `server.js`'s middleware resolves the locale and binds it** to the request through `AsyncLocalStorage`. Its strategies:
  - `cookie`;
  - `preferredLanguage` (`Accept-Language`);
  - `url`: a non-base locale is the first path segment, and the base locale has no prefix.

  The base locale is always the last resort, so the config does not list it.
- **A call reads the bound locale once and indexes its variant with it:** the request keeps the locale's position in `locales`, so there is no search and no strategy per call. `setLocale` in a request changes the locale for the rest of that request.
- **On the server outside a request** (scripts, crons, Node tests), one process-wide value is bound. It starts as the base locale, and `setLocale(locale, { reload: false })` changes it.
- **On the client,** the page's `<html lang>` is the locale, else the base locale. `setLocale(locale)` writes the cookie (`cookie`) or goes to the localized URL (`url`), and reloads. With `{ reload: false }` it switches in the page, which holds every locale until an adapter builds one locale per page; what it does then is the open question above.

The runtime's names are the ones existing Paraglide call sites use, so migrating changes imports, not calls. Only the middleware has a name of its own:
- `runtime.js`: `getLocale`, `setLocale`, `locales`, `baseLocale`, `Locale`, `isLocale`, `assertIsLocale`, `cookieName`, `getTextDirection`, `MessagePart`;
- for the `url` strategy: `localizeHref`, `localizeUrl`, `deLocalizeUrl`, `extractLocaleFromUrl`;
- `server.js`: `middleware(request, ({ request, locale }) => response)`.

## CLI

- `grai compile` writes the output once; `grai watch` keeps it current, incrementally.
- `grai check` runs every compile check (lockstep, plural categories) without writing, and adds two of its own:
  - keys no source file names. A key counts as named when it is an identifier anywhere in a JavaScript, TypeScript, Svelte or Vue file under the project, or under `--source`, outside dependencies, build output and the outdir. That counts `m.key` and per-key imports alike, and never calls a key unused that some code names;
  - inputs one locale reads and another never does, which is a translation that lost or invented a placeholder.
- Every command prints each error on its own line, sorted by file, key and locale, then how many, and exits with 1. A usage error exits with 2.
- `grai add <key> --en "…" --de "…"` adds a key to every catalog at once, and refuses unless every locale is given.

## Package

- **One package, `grai`.** A project installs one thing, and the adapters version with the compiler they wrap. Subpath exports, each added with its code:
  - `grai`: the compiler's API;
  - `grai/vite`, `grai/sveltekit`, `grai/next`, `grai/server`: the adapters, each thin, each taking the project's generated modules;
  - the `grai` binary: the CLI.
- **No dependencies.** The generated output needs only the platform, and `AsyncLocalStorage` on the server. Each locale's text direction is worked out when grai compiles, so the runtime looks it up by index. The compiler needs only Node. Vite, SvelteKit and Next are optional peer dependencies of their adapters.
