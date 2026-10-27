# Changelog

What changes for those who use grai, release by release, newest first. Until 1.0, a minor release may change the API that `docs/api.md` lists.

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
