# Changelog

What changes for those who use grai, release by release, newest first. Until 1.0, a minor release may change the API that `docs/api.md` lists.

## 0.1.1 (unreleased)

Dev servers that serve their first page sooner and load only its locale's words, Next.js pages that compile only the keys their routes read, and a lighter package.

### The compiler
- A module of keys is named by its shape: its keys, each one's kind, inputs and markup, and what the module imports. An edit to a message's words rewrites the module in place, under the name it had, and leaves `keys.js` as it is, so a bundler that watches the outdir compiles that one module again. An edit that adds or removes a key, or changes a key's inputs or markup, gives the module a new name, as every edit did before, so a process that loads one module before such an edit and another after never calls a key by its old inputs beside another by its new ones.
- The outdir has a `package.json` of its own. Its modules are ES modules whatever the project's `package.json` says, so a CommonJS project's Node loads them without a warning at each, and only `server.js` has side effects, so a bundler leaves out the modules of keys no code reads.
- A compile does less work for each message: it reads a pattern's text a run at a time rather than a character at a time, and a select's variants as they were parsed.

### The commands
- The CLI loads only the command it runs, so `grai help` and `grai compile` start sooner.
- `grai check`, `find` and `rename` read a Svelte component in async mode, where any expression of its template may `await`.

### The adapters
- **A dev server's first start serves its first page sooner.** With no saved build, as after a clone or an upgrade of grai, it serves the first page from its first compile, in memory: a message that is plain text in every locale is taken as it is, unparsed. It declares the keys and writes the output once the process is quiet, two seconds after at the latest. Until then the output's files come from memory, by their paths with or without `.js` and by package imports too, and grai writes them first where only a file on disk will do: a glob, an import with a query, Vite's dependency scan, and Vitest's servers.
- **A restart serves its first page from the saved build's index,** about a tenth of the build, while the catalogs are as they were, and takes up the build once the server is quiet. It loads the compiler only then, and the watch starts once the server listens, so neither holds up Vite's start.
- **A dev page loads its own locale's words alone,** as a built page loads its locale's copies. Its import map points `keys.js` at its locale's module, and a preload fetches it first: `@xyrolle/grai/vite`'s locale script writes them, and so do SvelteKit's `handleLocale`, Astro's middleware and Nuxt's plugin. A Vitest run keeps every locale's words, as `useLocale` switches between them.
- A dev server of a plain Vite app no longer loads grai's code readers or its chunking, which a build alone needs.
- **Next.js: each route's keys in a few modules.** Once `next dev` is quiet, the watch reads the app's code and saves the keys each route reads, on the server and in the client apart, as groups (`.grai/groups.json` in the outdir). Every compile, `next build`'s too, puts each group's keys in a module of its own, so Turbopack compiles a page's keys and few others. The reading follows keys through barrels and `export *`, and takes the routes by the app's page extensions, `page.tsx` too. Groups out of date cost speed, never a key.
- **Next.js: a fresh clone's first start.** `next dev` reads the groups beside its first compile and places the keys by them before Next starts. It writes the output's modules first, and their declarations once the server is quiet, and `withGrai` checks the output without loading the compiler. `withGrai` fails when the watch fails or stops before it is ready, rather than leave Next waiting, and prints each error the watch reports.
- **Next.js: an edit to a message's words** rewrites its module of keys in place, so Turbopack compiles that module again and nothing else.

### Locales on the server and in the page
- The page's locale script holds only the readers of the places the config's `strategy` reads, and the import map's code only in a build with `localeChunks`. `@xyrolle/grai/vite` writes it from the runtime's own functions, and parses `server.js` only for a strategy that matches a language.
- A Svelte server build reads every text through one getter that all texts share, rather than a getter of each key's own.

### The package
- `dist` is bundled: a module per entry, and chunks of what they share, so importing grai loads a few modules rather than one per source file. Each module ships with its source map, which holds grai's sources, so a stack trace under `node --enable-source-maps` names grai's source file and line.
- A start identifies the compiler by the list of its modules that grai's build ships, on Windows too, rather than by hashing every module of the package, and loads no parser to do so.

## 0.1.0 (2026-10-27)

The first release, published as `@xyrolle/grai`.

### The compiler
- `grai compile` and `grai watch` compile inlang message-format catalogs into a typed function per message: plurals and ordinals, selects, markup with its options and attributes, and Intl formatting with `:number`, `:percent`, `:currency`, `:unit`, `:datetime`, `:relativetime` and `:list`. An edit recompiles only the messages it changes, and no reader sees a half-written output.
- A catalog can nest keys, and a locale's messages can be split across several catalogs. Locales can take the messages they lack from another locale of their language (`fallbacks`), and `identicalToBase` names the messages that rightly read as the base locale's. A pseudo-locale, accented and longer, is compiled for development.
- The output declares each message's inputs and options, from every locale's use of them, so a call that type-checks renders. Its declaration maps take go to definition to the key in the base locale's catalog.

### The commands
- `grai check`, `find`, `rename` and `check --fix` read the code through a parser, as the bundler reads it: scripts with oxc, and Svelte, Vue, Astro and MDX components through their own frameworks' parsers. So a comment or a string that names a key is no call, and a read that may reach a key without naming it is reported. `rename` changes every call site and the bindings named after the key. `check --fix` removes the keys no shipped code can read, and imports each key from its own path.
- `grai add` adds a key to every catalog. `seed`, `export` and `merge` take messages to translators as XLIFF 2.0 and back, refusing a stale or invalid translation. `import` converts i18next and ICU catalogs, and `migrate` rewrites the calls of i18next, react-i18next, next-intl and react-intl that name their message plainly.

### The adapters
- `@xyrolle/grai/vite` compiles when Vite starts and patches an edited message into the open page. In a build it gives each chunk only the keys its code uses, and fails where code reads a key no catalog has.
- `@xyrolle/grai/svelte`, `@xyrolle/grai/sveltekit` and `@xyrolle/grai/sveltekit/vite` fit grai to Svelte and SvelteKit. In dev, `@xyrolle/grai/sveltekit/client` draws an edited message again in place.
- `@xyrolle/grai/next`, `@xyrolle/grai/next/config` and `@xyrolle/grai/next/proxy` fit it to Next's App Router, and `@xyrolle/grai/react`'s `Markup` draws markup in server and client components.
- `@xyrolle/grai/astro` fits it to Astro, in a static build and on demand.
- `@xyrolle/grai/vue` and `@xyrolle/grai/vue/client` fit it to Vue, and `@xyrolle/grai/nuxt` to Nuxt.
- `@xyrolle/grai/register`, loaded with `node --import @xyrolle/grai/register`, gives each key's own path a module of that key alone in Node, as `@xyrolle/grai/vite` does in a build and a test run.

### Locales on the server and in the page
- The output's `server.js` resolves each request's locale by the config's `strategy`: the cookie, the URL, `Accept-Language`, a query parameter, or a strategy the server defines with `defineServerStrategy`. It binds the locale for everything the request renders, and lists what it read in `Vary`. `withLocale` runs a job's or a test's code in a locale.
- The `url` strategy takes a prefix per locale (`localePrefix`, `localePrefixes`), leaves paths alone (`unlocalizedPaths`), translates paths into each locale's words (`pathnames`), and serves an app under a base path (`basePath`) or each locale from a host of its own (`domains`). The adapters route each of these: a static Astro build writes each prerendered page at its translated paths, and Nuxt routes a hosted locale's words.
- In a server build, a message with inputs switches on the locale in its own code, rather than calling one of a function per locale.
- A build can write a copy of each message chunk per locale, with only that locale's words. The page then loads only its own locale's copies, through an import map that the adapters and Vite's locale script write, under a CSP too.
- The page's runtime is `getLocale`, `setLocale`, the URL helpers and the locale functions, about 1 KB minified and gzipped.
