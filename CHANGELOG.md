# Changelog

What changes for those who use grai, release by release, newest first. Until 1.0, a minor release may change the API that `docs/api.md` lists.

## 0.1.0 (unreleased)

The first release.
- `grai compile` and `grai watch` compile inlang message-format catalogs into a typed function per message: plurals and ordinals, selects, markup with its options and attributes, and Intl formatting with `:number`, `:percent`, `:currency`, `:unit`, `:datetime`, `:relativetime` and `:list`. An edit recompiles only what it changes, and no reader sees a half-written output.
- `grai check`, `add`, `find`, `rename` and `check --fix` keep the catalogs and the code in step; `seed`, `export` and `merge` take messages to translators as XLIFF 2.0 and back; `import` converts i18next and ICU catalogs.
- `grai/vite` compiles when Vite starts, patches an edited message into the open page, and gives each chunk only the keys its code uses. `grai/svelte` adds to it a client build that reads a message without inputs as its string.
- `grai/sveltekit`, `grai/next` with `grai/next/config` and `grai/next/proxy`, and `grai/react` fit it to SvelteKit, Next and React. `grai/sveltekit/client` draws an edited message again in place in dev, without a reload.
- The output's runtime: `getLocale`, `setLocale`, the URL helpers and the server's `middleware`, under 1 KB minified and gzipped.
