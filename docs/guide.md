# Guide

Catalogs are the inlang message format, one JSON file per locale, as Paraglide reads them. `grai.config.json` names them:

```json
{
	"$schema": "./node_modules/grai/config.schema.json",
	"locales": ["en", "de"],
	"baseLocale": "en",
	"catalogs": "messages/{locale}.json",
	"outdir": "src/lib/i18n"
}
```

```json
{
	"cart_title": "Your cart",
	"cart_total": "Total {amount :number style=currency currency=EUR}"
}
```

`grai compile` writes the output; `grai watch` writes it again on each edit. The output has a `.gitignore` of its own, so Git, Prettier and Biome skip it; ESLint needs the outdir in its `ignores`. Each message becomes a typed function:

```ts
import { m } from "./src/lib/i18n/messages.js";

m.cart_title(); // "Your cart"
m.cart_title({}, { locale: "de" }); // the German text
m.cart_total({ amount: 12.5 }); // "Total €12.50"
```

`runtime.js` beside it has `getLocale`, `setLocale` and the URL helpers; `docs/api.md` lists the whole API. Beyond `compile` and `watch`:
- `grai check` reports problems, unused keys and untranslated ones. It reads code as the bundler does: each file through its own parser, a component through its framework's, and each import resolved by the project's Vite aliases, tsconfig paths and package.json `imports`. A key no shipped code reads is unused, and one that only tests read is too; the config's `tests` globs say which files are tests. A file that does not parse is an error. So is an import of keys by name from keys.js where package.json `imports` gives each key its own path, as an editor's auto-import writes it: a mock of a key's path reaches only the imports by that path. When the output is missing, check compiles it first, since the code's imports of it resolve only then;
- `grai add` adds a key to every catalog that lacks it, at once;
- `grai find`, `grai rename` and `grai check --fix` find a key's call sites, rename a key in every catalog and call site (and a binding named after it, with every reference), and remove the keys no shipped code reads or may reach, listing each one; `check --fix` also imports each key from its own path where an import takes it from keys.js. They read the code as `check` does, so a comment or a string that spells a key is no call site. A load by a path the code computes, `import(path)`, reaches no key, as a bundler bundles nothing for it. So an app that runs the output unbundled and loads a key's module by a path it builds at run time would lose that key to `check --fix`;
- `grai seed`, `grai export` and `grai merge` take a locale's messages to translators as XLIFF 2.0, and their translations back;
- `grai help` lists every command.

A `"pseudoLocale"` in the config, such as `"en-XA"`, is the base's messages accented, about 35% longer and in brackets, for finding text that bypasses the catalogs and layouts that break. `grai watch` and the Vite dev server compile it; `grai compile` and builds never do.

## A static site, an Electron app or an extension

Where no server picks the locale, each page the plugin builds picks it itself, before any module loads, from the places the config's `strategy` lists, in order:

```json
{
	"strategy": ["query", "localStorage", "preferredLanguage"],
	"queryParameter": "lng",
	"localStorageKey": "locale"
}
```

- `cookie` (with `cookieName`) and `localStorage` (with `localStorageKey`) hold the visitor's choice, which `setLocale` writes;
- `query` (with `queryParameter`) is a link's `?lng=de`;
- `preferredLanguage` is the browser's languages, matched as the server matches `Accept-Language`: `de-AT` finds `de`;
- `url` is the path's first segment, `/de/cart`.

A server reads the same list where it can, so a page it draws picks the same locale. The page's `<html lang>`, as its template has it, is only a default, which the page keeps where no place of the strategy names a locale; a server or a prerender that writes another locale's `lang` in its place drew the page in that one, and the page keeps it.

With `grai({ localeChunks: true })`, the page then loads only its locale's words: the build writes each message chunk's copy per locale, and the script points the page at its locale's. With a Content Security Policy that allows scripts by hash, add the hashes the build's log names to `script-src`; they change only with the config, Vite's `base` or grai. With Vite's `html.cspNonce`, nothing more is needed.

## Changing locale

`setLocale(locale)` keeps the visitor's choice in each place the strategy lists that holds one, its cookie, its key in `localStorage`, its query parameter or its path, and loads the page again in it. A page keeps its words while it lives, so `setLocale(locale, { reload: false })` only keeps the choice, for the page's next load. The browser's languages hold no choice, so a strategy must list one of those places for `setLocale` to change a page's locale; without one, a page would load in its old locale again, and `setLocale` throws a `GraiError` (`locale-unkept`) instead. A static app keeps the choice in `localStorage`, and an app a server draws in a cookie, which the server reads too:

```json
{
	"strategy": ["cookie", "preferredLanguage"],
	"cookieName": "lang"
}
```

## Tests

A test picks the locale it renders in with `useLocale` from the output's `testing.js`, in `beforeEach`. Then the messages called next render in it, and so does a component given that locale, which a page in another locale refuses. It sets `<html lang>` and `dir` too. The runtime reads `<html lang>` only once, when it loads, so a test that changes `lang` itself leaves the locale as it was. A build refuses `testing.js`.

```ts
import { useLocale } from "./src/lib/i18n/testing.js";

beforeEach(() => useLocale("de"));
```

`useLocale` binds a page's or a script's locale. A process that loads `server.js` renders every message in a request instead, so a test there runs inside one, through `server.js`'s `withLocale`, which binds it as the middleware binds a request:

```ts
import { withLocale } from "./src/lib/i18n/server.js";

aroundEach((test) => withLocale("de", test));
```

A key's own path, `#i18n/messages/<key>.js`, is a module of that key alone wherever grai resolves it, so a test that mocks one key's path mocks that key and no other: in Vite's builds and in Vitest, through grai's plugin, and in Node through `grai/register`, loaded before the app. Without them every key's path is keys.js, and a mock of one mocks them all.

```sh
node --import grai/register --experimental-test-module-mocks --test
```

```ts
mock.module("#i18n/messages/cart_title.js", {
	namedExports: { cart_title: () => "Cart" },
});
```

node:test's `mock.module` resolves through the hook from Node 24.12 and 25.1 ([nodejs/node#60326](https://github.com/nodejs/node/pull/60326)); on Node 22 it resolves in a loader thread the hook does not reach, and leaves the key unmocked. The hook is built on `module.registerHooks`, which Node marks a release candidate from 24.13.1 and 25.4, and in active development on Node 22.

## CI

`grai check` reads code exactly. It parses each file whose text may read messages and resolves that file's imports. It keeps each file's facts in the outdir's `.grai/facts`, so a later check parses only the files that changed. Keep that file in CI's cache between runs. On GitHub Actions, add this step before the check:

```yaml
- uses: actions/cache@v6
  with:
    path: src/lib/i18n/.grai/facts
    key: grai-facts-${{ hashFiles('pnpm-lock.yaml', 'grai.config.json') }}-${{ github.sha }}
    restore-keys: grai-facts-${{ hashFiles('pnpm-lock.yaml', 'grai.config.json') }}-
```

The key changes with the lockfile, which pins the parsers, and with the config. While both stay the same, each run restores the latest facts and saves its own. The facts are kept by each file's path, and a runner checks out to the same path every run.

On a developer's machine, grai also knows each unchanged file by its stat (`.grai/files`), so a command reads only the files that changed since the last. A fresh checkout gives every file a new stat, so in CI grai reads each file's text and takes its facts by their hash.

Take app B: 8,971 source files, of which 2,269 may read messages. A check takes 2.9 s with nothing kept, 1.8 s in CI with the facts kept, and 1.0 s on a machine where nothing changed.
