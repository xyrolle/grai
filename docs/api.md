# API

grai 0.1's public surface. Anything this page does not list is internal, and may change in any release.

## `@xyrolle/grai`

The compiler, for a build script or a bundler grai has no adapter for.

- `compile(configFile: string): Promise<CompileResult>`: compiles the project and writes its output, unless the output is already that of the same config and catalogs. It never throws a `GraiError`: each one is in the result.
- `type CompileResult = { written: string[]; errors: GraiError[] }`: the files written, relative to the outdir, or every error, sorted by file, key and locale.
- `class GraiError extends Error`: a compile failure, with `code: GraiErrorCode`, `file: string`, and `key` and `locale` (`string | undefined`) where they apply.
- `type GraiErrorCode`: the failure's stable name, such as `"key-missing"` or `"catalog-invalid"`.

## `@xyrolle/grai/vite`

- `grai(options?: { config?: string; reloadOnEdit?: boolean; localeChunks?: boolean }): Plugin[]`: compiles when Vite starts, patches an edited message into the open page in dev, and in a build puts in each chunk only the keys its code uses, once per locale. A build reads each module's messages as `grai check` does, before any other plugin transforms it, and fails where code reads a key no catalog has. Each page it builds or serves gets a locale script, which picks the page's locale where no server did. `config` is the path of `grai.config.json`, from Vite's root; `reloadOnEdit` reloads the open pages after an edit rather than patch them, for a framework whose pages only the server draws, such as Astro; `localeChunks` writes a copy of each message chunk per locale, with only its words, which the locale script then points each page at.
- `graiModules(options?: { config?: string }): (id: string) => GraiModuleKind | undefined`: for a tool that reads a client build's chunks, the kind of grai's module an id is, or `undefined` for any other. `config` is the path of `grai.config.json`, from the working directory.
- `type GraiModuleKind = "runtime" | "config" | "plurals" | "formats" | "key" | "text"`: the first four go to the `grai-runtime` chunk, `key` and `text` to the message chunks under `grai/`.

## `@xyrolle/grai/register`

- Loaded with `node --import @xyrolle/grai/register`, it gives each key's own path, `…/messages/<key>.js` mapped to the output's keys.js, a module of that key alone in Node, as `@xyrolle/grai/vite` does in a build and a test run. A key no catalog has fails the import with a `key-missing` GraiError. It exports nothing.

## `@xyrolle/grai/svelte`

- `grai(options?: { config?: string; reloadOnEdit?: boolean }): Plugin[]`: `@xyrolle/grai/vite`'s plugin, and in the client build a component's call of a message without inputs, such as `{m.title()}`, reads that message's string in the page's locale. List it before `sveltekit()` or `svelte()`. It needs `svelte` and `magic-string`.

## `@xyrolle/grai/sveltekit`

- `handleLocale({ middleware, getTextDirection, localeCopies }): Handle`: the `handle` that renders each request in its locale, from the output's `server.js` and `runtime.js`. It resolves the locale by the config's `strategy`, binds it for everything the request renders and loads, and writes it and its direction into `src/app.html`'s `%grai.lang%` and `%grai.dir%`. A built page loads only its locale's copies of the message chunks, when the build wrote them (`localeCopies`).

## `@xyrolle/grai/sveltekit/vite`

- `grai(options?: { config?: string }): Plugin[]`: `@xyrolle/grai/svelte`'s plugin, which also writes a copy of each message chunk per locale for `handleLocale`'s pages. List it before `sveltekit()`.
- `type SvelteKitGraiOptions`: its options.

## `@xyrolle/grai/sveltekit/client`

It exports nothing: an app imports it once, from `src/hooks.client.ts`, for what it does in dev. A catalog edit then draws the text it changed again in place: the renders that read an edited message run again, and once the server has the edit, so do the page's loads and remote functions. A build leaves it out.

## `@xyrolle/grai/sveltekit/navigation`

- `reloadAcrossLocales({ localizeUrl }): void`: called once as the root layout initializes, it loads a page of another locale as a document, which the server draws in that locale, and leaves every navigation within the page's locale to Kit. It takes the output's `runtime.js` `localizeUrl`: a URL is another locale's when putting it in the page's locale changes its path.
- `type PageUrls`: what it takes.

## `@xyrolle/grai/next`

- `bindLocale(locale: string): void`: binds the locale for the rest of the request's render. A page, a layout or `generateMetadata` calls it before any message, with the locale its params name.
- `LocaleProvider({ locale, children }: { locale: string; children?: ReactNode }): ReactNode`: gives client components the request's locale while the server renders them. In a browser, a client navigation into another locale switches to it with `setLocale`.

## `@xyrolle/grai/next/config`

- `withGrai(nextConfig?: NextConfig): (phase: string) => Promise<NextConfig>`: wraps the Next config. `next dev` compiles the catalogs and recompiles on each change, `next build` compiles them and fails on any error, and both bundlers resolve `@xyrolle/grai/next`'s imports of the output to the config's `outdir`.

## `@xyrolle/grai/next/proxy`

- `proxy(request: NextRequest): Promise<Response>`: resolves the request's locale by the config's `strategy` and rewrites it to the same path under `/<locale>`, its `Vary` listing the headers the strategy reads.

## `@xyrolle/grai/react`

- `Markup<Tag>({ parts, markup }: { parts: readonly MessagePart<Tag>[]; markup: Record<Tag, (children: ReactNode | undefined, details: { options; attributes }) => ReactNode> }): ReactNode`: draws a markup message's `.parts()` with the app's function for each of its tags, in server and client components alike. Each function takes what its element encloses and the options and attributes the message writes on it, and decides what they do: none reaches the page on its own. A tag the message writes and `markup` lacks is a type error, and throws, naming it.

## `@xyrolle/grai/astro`

- `grai(options?: { config?: string }): AstroIntegration`: the Astro integration. It adds `@xyrolle/grai/vite`, compiles for `astro sync`, checks that the two configs agree on where a page's locale comes from, and adds the middleware that renders each request in its locale, ahead of the app's own. `config` is the path of `grai.config.json` from Astro's root.
- `type GraiAstroOptions`: its options.

## `@xyrolle/grai/astro/middleware`

What the middleware the integration writes imports; apps never do.
- `localeMiddleware(project: LocaleProject): (context: LocaleContext, next: () => Promise<Response>) => Promise<Response>`: Astro's middleware, from the output's `server.js` and the integration's reading of the two configs.
- `type LocaleProject` and `type LocaleContext`: what it takes and reads.

## `@xyrolle/grai/astro/translated-paths`

What the routes the integration adds for `pathnames` import; apps never do.
- `translatedStaticPaths(project: TranslatedPages): (options: { routePattern: string }) => Promise<{ params }[]>`: the `getStaticPaths()` of the route the integration adds for each path in a locale's words, which lists, from each prerendered page's own `getStaticPaths()`, the pages a static build writes there.
- `type PageRoute` and `type TranslatedPages`: what it takes.

## `@xyrolle/grai/vue`

- `Markup<Tag>({ parts, markup }: { parts: readonly MarkupPart<Tag>[]; markup: MarkupElements<Tag> }): VNode[]`: a functional component that draws a markup message's `.parts()`, each element by the app's function in `markup`. An element the parts name and `markup` lacks is a type error, and throws, naming it.
- `type MarkupPart<Tag>`, `type MarkupElement`, `type MarkupElements<Tag>` and `type MarkupDetails`: what it takes and calls each function with.

## `@xyrolle/grai/vue/client`

It exports nothing: an app imports it once, from the browser's entry, for what it does in dev. A catalog edit then renders again, in place, what called an edited message, and the page keeps its state. A build leaves it out.

## `@xyrolle/grai/nuxt`

- The Nuxt module, `modules: ["@xyrolle/grai/nuxt"]`, with `grai: { config }` for a config other than `grai.config.json` in the project's root. It compiles before Nuxt builds anything and again on each edit in dev, resolves each request's locale by the config's `strategy` in a server middleware, binds it for the render and writes it with its direction to `<html>`. With the `url` strategy it routes each page under each prefixed locale's prefix, in the locale's words where `pathnames` gives them.
- `type GraiNuxtOptions`: its options.

## The `grai` command

Every command takes `--config <file>`, `grai.config.json` in the current directory by default. It exits with 0, with 1 when it reports errors, and with 2 on a usage error.

- `grai compile`: writes the output, if the catalogs or the config changed.
- `grai watch`: writes it, then again on each change of a catalog or the config.
- `grai check [--source <dir>]... [--json]`: reports every problem, reading the code as the bundler does. It writes nothing but the output, which it compiles first when it is missing. `--json` prints `{ problems: [{ code, file, key, locale, message }], untranslated: { [locale]: string[] } }`.
- `grai check --fix [--source <dir>]...`: removes from every catalog the keys no shipped code reads or may reach, lists each one, writes each import of keys by name from keys.js as an import of each key from its own path where package.json `imports` gives one, lists each, then checks. It removes nothing while a source does not parse.
- `grai add <key> --<locale> <text>...`: adds the key to every catalog, with a text for each locale, then compiles.
- `grai find <key> [--source <dir>]...`: prints the key's line in each catalog, each call site, and each read that may reach the key without naming it, reading the code as `check` does.
- `grai rename <key> <new> [--source <dir>]...`: renames the key in every catalog and at every call site, a binding named after it with every reference to it, then compiles. It changes nothing while a read may reach the key without naming it, or where a binding's new name is taken, and names the place.
- `grai seed <locale>`: gives the locale's catalog the base text of each key it lacks, then compiles.
- `grai export <locale> [--untranslated] [--json]`: prints the locale's messages as XLIFF 2.0. `--json` prints `{ srcLang, trgLang, units: [{ id, key, variant?, note?, source, target? }] }`.
- `grai merge <file>`: writes an exported file's translations into its locale's catalog, then compiles.
- `grai import --from i18next|icu <file or dir>...`: converts another library's catalogs into new grai catalogs, writes `grai.import.json`, which maps each source key to its grai key, and reports each message it leaves out or renders differently.
- `grai migrate [--source <dir>]... [--default-namespace <ns>]`: rewrites each call of the imported library that names its message plainly as a call of the grai message `grai.import.json` maps it to, and reports every other call, for a person to migrate ([docs/migrating.md](migrating.md)).
- `grai help`: lists the commands.

## `grai.config.json`

- `locales: string[]`: the project's locales, as BCP 47 tags in their canonical form.
- `baseLocale: string`: one of `locales`; the locale a call renders in when nothing binds another.
- `catalogs: string | string[]`: each locale's catalog, as a path with `{locale}` in it, such as `"messages/{locale}.json"`, or a list of such paths where a locale's messages are split across files: a key is in one of them, and a new key goes in the first. A catalog may nest keys in objects; a nested key is called by its names joined by `_`.
- `outdir: string`: the directory the output goes to.
- ``strategy?: ("cookie" | "localStorage" | "preferredLanguage" | "query" | "url" | `custom-${string}`)[]``: where the server and a page no server draws look for the locale, in order, before the base locale. Each reads the places it can see: the server no `localStorage`. A `custom-` name, such as `"custom-session"`, is a strategy the server defines with `server.js`'s `defineServerStrategy`, which a page does not read.
- `cookieName?: string`: the cookie the `cookie` strategy reads and `setLocale` writes, a name RFC 6265 allows; required with it, refused without it.
- `cookieMaxAge?: number`: the seconds a browser keeps the cookie, 400 days by default.
- `cookieDomain?: string`: a host whose subdomains share the cookie, such as `example.com`.
- `cookieSameSite?: "lax" | "strict" | "none"`: the cookie's SameSite, `"lax"` by default; `"none"`, for a page embedded in another site's, makes it Secure.
- `localStorageKey?: string`: the key in `localStorage` the `localStorage` strategy reads and `setLocale` writes; required with it, refused without it.
- `queryParameter?: string`: the URL's query parameter the `query` strategy reads and `setLocale` names the locale in; required with it, refused without it.
- `switch?: "reload"`: how a page changes locale. `"reload"`, the default, reloads or navigates. `"live"`, where a page would switch in place, is refused until grai does it (`docs/followups.md`).
- `localePrefix?: "as-needed" | "always"`: with the `url` strategy, whether the base locale's paths have a prefix too; `"as-needed"`, the default, leaves them without one.
- `localePrefixes?: Record<string, string>`: with the `url` strategy, a locale's own prefix, one path segment, such as `{ "en-US": "us" }`.
- `unlocalizedPaths?: string[]`: with the `url` strategy, globs of the paths it leaves alone, such as `["/api/**"]`, whose locale the strategies after it find.
- `pathnames?: Record<string, Record<string, string>>`: with the `url` strategy, a route's path in each locale's words, such as `{ "/about": { "de": "/ueber-uns" }, "/products/[id]": { "de": "/produkte/[id]" } }`, which `localizeHref` writes and `deLocalizeUrl` reads back as the route. A segment written `[name]` is carried across, and each locale's path names the route's segments.
- `basePath?: string`: with the `url` strategy, the path the app is served under, such as `"/shop"`, which the locale's prefix follows. The framework's base path must be the same: Vite's `base`, SvelteKit's `paths.base`, Next's `basePath`, Astro's `base` or Nuxt's `app.baseURL`.
- `domains?: Record<string, string>`: with the `url` strategy, every locale's own host, such as `{ "en": "example.com", "de": "example.de" }`. There a request's host names its locale, paths have no prefix, and a link to another locale is a whole URL. On any other host, such as `localhost` in development, the prefix names the locale.
- `tests?: string[]`: globs of the source files that are tests, which `grai check` does not count as using a key; `[]` makes no file a test.
- `fallbacks?: Record<string, string>`: each locale that takes the messages it lacks from another locale of its language, such as `{ "en-GB": "en" }`.
- `identicalToBase?: Record<string, string[]>`: per locale, the keys whose message rightly reads as the base locale's, which `grai check` and `grai export` take as translated.
- `pseudoLocale?: string`: a locale, such as `"en-XA"`, made from the base's messages for development and tests, accented and about 35% longer; `grai watch` and the Vite dev server compile it, and no build does.
- `descriptions?: string`: a JSON file of each key's description for translators, which `grai export` writes as each unit's note.
- `$schema?: string`: `./node_modules/@xyrolle/grai/config.schema.json`, which the package ships, for an editor to complete and check the config.

Relative paths start from the config file's directory. [Config](config.md)'s table says more about each field.

## The output

The compiler writes these modules, with their declarations, into `outdir`.

### `messages.js`

- `m`: every message, by key. `m.key(inputs?, options?)` returns the message's text.

### `keys.js`

- Every message as a named export, `export const key: Message<…>`. Per-key import paths map to this file, as in `"#i18n/messages/*": "./src/lib/i18n/keys.js"` in `package.json`'s `imports`.
- A key's path names its key by its last segment, case and all, `…/messages/<key>.js`, and its import names that key: `import { title } from "#i18n/messages/title.js"`. A tool that walks an app's imports reads the key there, as grai's resolvers do.

### `runtime.js`

- `type Locale`: the union of the project's locales.
- `locales`: the project's locales, in the config's order, typed as a tuple of their literals.
- `baseLocale`: the config's base locale, typed as its literal.
- `getLocale(): Locale`: the locale messages render in: the request's on the server, the page's in a browser.
- `setLocale(locale: Locale, options?: { reload?: boolean })`: sets the locale for the rest of the request on the server, or for the process in a script. In a browser it keeps the locale where the strategy reads it, and reloads, or goes to the URL that names it; it throws `locale-unkept` where the strategy keeps a choice nowhere. With `{ reload: false }` it returns `void`, and only keeps the choice for the page's next load: the page keeps its words, and a test picks its locale with `testing.js`'s `useLocale`. Under `"live"`, which the config refuses until grai switches a page in place, it would return `Promise<void>`, resolving once the locale's message chunks are in.
- `isLocale(value: unknown): value is Locale`: whether a value is one of the project's locales.
- `assertIsLocale(value: unknown): Locale`: the value, if it is one of the project's locales; otherwise throws a `GraiError`.
- `getTextDirection(locale?: Locale): "ltr" | "rtl"`: the direction a locale's script is written in, the bound locale's by default.
- `extractLocaleFromUrl(url: string | URL): Locale`: the locale a URL's first path segment names, else the base locale.
- `deLocalizeUrl(url: string | URL): URL`: the URL without its locale prefix.
- `localizeUrl(url: string | URL, options?: { locale?: Locale }): URL`: the URL with a locale's prefix, the current locale's by default.
- `localizeHref(href: string, options?: { locale?: Locale }): string`: a path such as `/cart` with a locale's prefix; a relative href, such as `./cart`, read from the page's URL, on the server the request's; a URL with a scheme or a host of its own as it is.

The four URL helpers follow the `url` strategy. Without it no URL names a locale, so they leave every URL as it is, and `extractLocaleFromUrl` gives the base locale.
- `type Message<Inputs>`: a message, `(inputs, options?: { locale?: Locale }) => string`. Without inputs, `inputs` is optional and takes none.
- `type MarkupMessage<Inputs, Tag>`: a message with markup; its `.parts()` takes the same arguments and returns `MessagePart<Tag>[]`, `Tag` being the tags its locales write.
- `type MessagePart<Tag>`: `{ type: "text", value }`, or `{ type: "markup-start" | "markup-end" | "markup-standalone", name: Tag, options, attributes }`, an attribute without a value being `true`.
- `class GraiError extends Error`, made as `new GraiError(code, message)`: what a message or a locale function throws, with `code`:
  - `"locale-unknown"`: a value that is not one of the project's locales;
  - `"locale-not-loaded"`: a call, in a browser, in a locale other than the page's;
  - `"locale-unkept"`: `setLocale` in a page whose `strategy` keeps a choice nowhere;
  - `"value-unmatched"`: a value a closed select does not list;
  - `"format-option-invalid"`: an input that gives a formatter an option Intl refuses, such as an unknown currency;
  - `"locale-unbound"`: on a server, a message rendered outside every request the middleware binds, such as in a stream's `pull()` once the middleware has returned; in Next.js, a server component that renders a message before its page or layout bound the locale;
  - `"output-changed"`: a process that loaded the keys of one compile and the runtime of another, as when a compile changed the locales while it ran;
  - `"strategy-undefined"`: `server.js`'s `defineServerStrategy` called with a name the config's `strategy` does not list.

### `testing.js`

- `useLocale(locale: Locale): void`: binds a locale for a test in a page or a script, as if the page had loaded in it: the messages called next render in it, and so does a call that names it, which a page in another locale refuses. In a page it also sets `<html lang>` and `dir`. `@xyrolle/grai/vite` refuses the module in a build.

### `server.js`

- `middleware(request: Request, handler: (resolved: { request: Request; locale: Locale }) => Response | Promise<Response>): Promise<Response>`: resolves the request's locale by the config's `strategy`, binds it for the handler and everything it calls, and gives back the handler's response, its `Vary` listing the request headers the strategy reads.
- `withLocale<Result>(locale: Locale, code: () => Result): Result`: runs `code` in `locale` as the middleware runs a request's handler, so each message it calls and each task it starts renders in it: a scheduled job's code, or a test's, under Vitest `aroundEach((test) => withLocale("de", test))`.
- `localeCopies: boolean`: whether the build that compiled the output wrote a copy of each message chunk per locale, which `@xyrolle/grai/sveltekit`'s `handleLocale` reads.
- ``defineServerStrategy(name: `custom-${string}`, strategy: { getLocale(request: Request): string | undefined | Promise<string | undefined>; vary?: readonly string[] }): void``: defines one of the server's own strategies, which the config's `strategy` lists by its name: the middleware asks it for a request's locale in the strategy's order, and goes on where it names none. `vary` names the request headers it reads. Define each before the first request; a name the config does not list throws `strategy-undefined`.
- `vary: string`: the request headers the strategy reads, as the `Vary` the middleware adds, for a framework that sends its response apart from the middleware.
- `localeOf(request: Request): Promise<Locale>`: the locale the middleware binds for a request, for a framework that renders apart from it.
- `redirectOf(request: Request): Promise<Response | undefined>`: the redirect the middleware answers a request with, its `Vary` included, else `undefined`: with every locale's paths prefixed, a page asked for without a prefix is sent to its locale's path.

Everything else in `outdir` is internal: `internal.js`, the modules named by their content (`runtime-<hash>.js`, `config-<hash>.js`, `plurals-<hash>.js`, `formats-<hash>.js`), the shards under `keys/`, and `.grai/`.
