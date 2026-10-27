# Frameworks

How grai joins each framework's build and its requests. `examples/` holds a complete app for each.

## Vite

```ts
// vite.config.ts
import { grai } from "grai/vite";

export default { plugins: [grai()] };
```

The plugin compiles when Vite starts. In dev, it patches an edited message into the open page without a reload. In a build, a page loads the keys its code uses in few chunks: keys the same pages use share a chunk, and small sets of them are pooled (`docs/design.md`). With `grai({ localeChunks: true })`, the client build also copies each of those chunks once per locale, for an adapter that points each page at its own locale's copies, as `grai/sveltekit` does.

A tool that reads a client build's chunks can ask which of grai's modules an id is, rather than spell grai's module ids:

```ts
import { graiModules } from "grai/vite";

const kindOf = graiModules(); // reads grai.config.json
kindOf(id); // "runtime", "config", "plurals", "formats" (the grai-runtime chunk), "key" or "text" (a message chunk), or undefined
```

## Svelte

In a Svelte app, take the plugin from `grai/svelte`, listed before Svelte's, and in a SvelteKit app from `grai/sveltekit/vite` (below):

```ts
// vite.config.ts
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { grai } from "grai/svelte";

export default { plugins: [grai(), svelte()] };
```

It is `grai/vite`'s plugin, and in the client build a component's call of a message without inputs, such as `{m.title()}`, reads that message's string in the page's locale. Svelte draws a string as a plain value, where it gives each call a signal of its own, so a page of 2,000 messages with app A's catalog hydrates in two-thirds of the time (`docs/runtime.md`). The app needs `svelte` and `magic-string`. With `"switch": "live"` in the config, for a page that changes locale in place, every call stays a call.

## SvelteKit

`grai/sveltekit`'s `handleLocale` renders each request in its locale, from the output's middleware and text direction, and `grai/sveltekit/vite`'s plugin, listed before Kit's, builds the app. `examples/sveltekit` is a complete app.

```ts
// vite.config.ts
import { sveltekit } from "@sveltejs/kit/vite";
import { grai } from "grai/sveltekit/vite";

export default { plugins: [grai(), sveltekit()] };
```

```ts
// src/hooks.server.ts
import { handleLocale } from "grai/sveltekit";
import { getTextDirection } from "#lib/i18n/runtime.js";
import { localeCopies, middleware } from "#lib/i18n/server.js";

export const handle = handleLocale({ middleware, getTextDirection, localeCopies });
```

It resolves the locale by `grai.config.json`'s `strategy` and binds it while the request renders. It writes the locale into `src/app.html`'s `%grai.lang%` and `%grai.dir%`:

```html
<html lang="%grai.lang%" dir="%grai.dir%">
```

The browser takes the page's `<html lang>` as its locale, so it hydrates in the words the server drew. With the `url` strategy, Kit routes a path without its locale prefix:

```ts
// src/hooks.ts
import type { Reroute } from "@sveltejs/kit/hooks";
import { deLocalizeUrl } from "#lib/i18n/runtime.js";

export const reroute: Reroute = ({ url }) => deLocalizeUrl(url).pathname;
```

Links then name their locale with `localizeHref("/about")`. A page holds its own locale's words, so a link to another locale's page must load it as a document, as Kit would otherwise draw it in the client with the first page's locale. The root layout says so, once, and a navigation within one locale stays Kit's:

```svelte
<!-- src/routes/+layout.svelte -->
<script lang="ts">
	import { reloadAcrossLocales } from "grai/sveltekit/navigation";
	import { localizeUrl } from "#lib/i18n/runtime.js";

	let { children } = $props();
	reloadAcrossLocales({ localizeUrl });
</script>

{@render children()}
```

A built page downloads only its own locale's words. The plugin is `grai/svelte`'s, and it also writes a copy of each message chunk per locale, which the output's `localeCopies` says; `handleLocale` then writes the page an import map from the shared chunks to its locale's copies, and points Kit's preloads at the copies. Built with any other plugin, `localeCopies` is false, and a page loads the shared chunks.

In dev, an edited message shows in the open page without a reload once `src/hooks.client.ts` imports `grai/sveltekit/client`. Svelte draws again only what read the edited keys, and the page's loads and remote functions run again for the text they return. A build leaves the module out.

```ts
// src/hooks.client.ts
import "grai/sveltekit/client";
```

## Next.js

`grai/next` binds the locale in Next's App Router: the proxy resolves it, server components bind it, and client components get it on the server from `LocaleProvider` and in the browser from `<html lang>`. A message call stays a plain function. `examples/next` is a complete app.

```ts
// next.config.ts: `next build` compiles the catalogs, `next dev` recompiles on each save
import { withGrai } from "grai/next/config";

export default withGrai({ /* the app's own config */ });
```

`withGrai` reads `grai.config.json`, or the file its second argument names: `withGrai(nextConfig, { config: "grai.base.json" })`.

```ts
// src/proxy.ts
export { proxy } from "grai/next/proxy";

export const config = { matcher: ["/((?!api|_next|.*\\..*).*)"] };
```

The proxy resolves the locale by `grai.config.json`'s `strategy` and rewrites the request to the same path under `/<locale>`, so the pages live under `app/[locale]/`. The URL stays as the strategy has it: with `url`, `/about` for the base locale and `/ro/about` for the others.

```tsx
// src/app/[locale]/layout.tsx
import { bindLocale, LocaleProvider } from "grai/next";
import { getTextDirection, locales } from "@/i18n/runtime.js";

export function generateStaticParams() {
  return locales.map((locale) => ({ locale }));
}

export default async function RootLayout({ children, params }: LayoutProps<"/[locale]">) {
  const { locale } = await params;
  bindLocale(locale);
  return (
    <html lang={locale} dir={getTextDirection()}>
      <body>
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
```

- **Every page, layout and `generateMetadata` calls `bindLocale` before its messages.** Next renders them side by side, and a client navigation renders only some of them. A message before it throws, saying so.
- **Client components call messages as they are.** In the browser a page keeps the locale it was loaded in; a link into another locale loads that page, and `setLocale(locale)` switches to it.
- **Import the messages as a namespace, from `keys.js`:** `import * as m from "@/i18n/keys.js"`, as the example does. `next dev` then takes each message a module calls from the shard that holds it. `import { m }` from `messages.js` gives it one namespace of every key, which it builds whole in each of Next's layers, and again after each edit. `grai migrate` writes this import in a Next app, one whose package.json depends on `next`.
- **Server actions and route handlers name the locale:** `m.saved({}, { locale })`. React keeps no request state there.
- **Per-key imports** (`import { title } from "#i18n/messages/title.js"`) map to the output's keys.js through package.json `imports`, as in the example.
- **Vitest takes grai's plugin in its own config,** as a Next app has no Vite config. A key's path is then a module of that key alone in tests, so `vi.mock` of one key's path mocks that key and no other:

  ```ts
  // vitest.config.ts
  import { grai } from "grai/vite";
  import { defineConfig } from "vitest/config";

  export default defineConfig({ plugins: [grai()] });
  ```
- **A markup message** renders with `grai/react`'s `Markup`, in server and client components alike. Each element's function takes what it encloses and the options and attributes the message writes on it, so `{#link href=|/terms|}terms{/link}` gives `options.href`:

  ```tsx
  <Markup parts={m.terms.parts()} markup={{ link: (children, { options }) => <a href={String(options.href)}>{children}</a> }} />
  ```

On a page of 400 messages in a server component and 100 in a client component, the browser downloads 130.4 KB brotli against next-intl's 230.7 KB, or its 134.6 KB with the client's keys picked, and an edit to a catalog is written in about 5 ms; the rest of the edit is Next's refresh (`bench/nextjs.mjs`, `docs/runtime.md`).

## Astro

`grai/astro` is an Astro integration. It adds `grai/vite`, compiles the catalogs for `astro build`, and for `astro sync`, which `astro check` runs. It adds a middleware that renders each request in its locale, islands included. `examples/astro` is a complete site, static and rendered on demand.

```ts
// astro.config.ts
import { defineConfig } from "astro/config";
import { grai } from "grai/astro";

export default defineConfig({
	i18n: { locales: ["en", "ro", "ar"], defaultLocale: "en" },
	integrations: [grai()],
});
```

The middleware resolves the locale by `grai.config.json`'s `strategy` and binds it while the page renders. It writes the locale and its text direction to `<html lang>` and `dir`. The browser's runtime takes `<html lang>` as the page's locale, so a Svelte or React island hydrates in the words the server drew. In a build, each page loads only its own locale's copies of the message chunks, through an import map.

With Astro's i18n routing, the URL names each page's locale and Astro routes it. The pages live under `src/pages/[...locale]/`, or a folder per locale. `Astro.currentLocale` is the locale grai renders in, and `getRelativeLocaleUrl` links to each locale's page. The two configs must agree, and the build stops on any difference, saying what to set:

| Astro's `i18n` | grai's config |
|---|---|
| routing by the URL | `"url"` first in `"strategy"` |
| `locales: ["en", "ro"]` | `"locales": ["en", "ro"]` |
| `{ path: "romana", codes: ["ro"] }` | `"localePrefixes": { "ro": "romana" }` |
| `defaultLocale` | `"baseLocale"` |
| `routing.prefixDefaultLocale: true` | `"localePrefix": "always"`, with Astro's own routes in `"unlocalizedPaths"`: `/_image`, `/_server-islands/**`, `/404`, `/500` |
| a page outside the locales' paths | `"unlocalizedPaths"`, whose locale the strategies after `"url"` find |

A `base` and `domains` aren't supported yet.

A page whose locale comes from the request, through `cookie` or `preferredLanguage`, rather than from its URL, is rendered on demand. The build stops on a prerendered one, which would show every reader the one locale it was built in.

Under `<ClientRouter />`, a link into another locale needs `data-astro-reload`, so the page loads in its locale (`docs/followups.md`).

On a static site whose page renders 400 messages and a Svelte island 100, `astro build` takes 1.7 s against Paraglide's 6.0 s. The page downloads 22.1 KB against 25.4 KB, as its island loads only its own locale's words. In `astro dev`, an edited message the server renders shows in 84 ms. With Paraglide, the open page keeps its words until a reload by hand (`bench/astro.mjs`, `docs/runtime.md`).

## Vue

A message is a plain function, so a template calls it as it calls anything `<script setup>` imports, with Vite and `grai/vite` as above. Import the messages as a namespace, from `keys.js`: Vue's compiler takes a namespace import as a constant, so a build keeps only the keys the template calls, where `import { m }` would ship every key. `grai/vue`'s `Markup` draws a markup message's parts, each element by the app's function:

```vue
<script setup lang="ts">
import { Markup } from "grai/vue";
import { h } from "vue";
import * as m from "./i18n/keys.js";
</script>

<template>
	<h1>{{ m.cart_title() }}</h1>
	<Markup
		:parts="m.terms.parts()"
		:markup="{ link: (children) => h('a', { href: '/terms' }, children) }"
	/>
</template>
```

A server render binds the request's locale through the output's middleware, around Vue's render, so every setup, render and await in it reads that locale, and the page's response varies by the headers the strategy reads. `index.html` stays a page in the base locale, and the render writes the request's locale and direction into its `<html>`:

```ts
// src/entry-server.ts
const htmlOf = (locale: Locale) =>
	`<html lang="${locale}" dir="${getTextDirection(locale)}">`;

export const render = (request: Request, template: string) =>
	middleware(request, async ({ locale }) => {
		const page = template
			.replace(htmlOf(baseLocale), htmlOf(locale))
			.replace("<!--app-html-->", await renderToString(createApp()));
		return new Response(page, { headers: { "content-type": "text/html" } });
	});
```

The browser takes the page's locale from its `<html lang>`, so the page hydrates in the words the server drew. With `grai({ localeChunks: true })`, the page loads only its locale's words, as a static site's does: the page's locale script keeps the `lang` the server wrote and points the page at that locale's copies. In dev, `import "grai/vue/client"` in the browser's entry renders an edited message again in place, keeping the page's state; a build leaves it out. `examples/vue` is a complete server-rendered app.

## Nuxt

```ts
// nuxt.config.ts
export default defineNuxtConfig({ modules: ["grai/nuxt"] });
```

The module compiles the catalogs before Nuxt builds anything, and again on each edit in dev, where the open page renders the edit again in place. Its server middleware resolves each request's locale by `grai.config.json`'s `strategy`, the render binds it, and the page's `<html lang>` and `dir` take it. Templates call messages, and `grai/vue`'s `Markup` draws markup, as in any Vue app.

- With the `url` strategy, every page is also routed under each other locale's prefix (`/ro/about`), the base locale's too with `localePrefix: "always"`, and links name their locale with `localizeHref("/about")`. A locale's prefix is the one `localePrefixes` gives it, a page at a path `unlocalizedPaths` names has no copies, and a page asked for without the prefix it needs is sent to its locale's path, as the output's middleware sends it. A link into another locale loads that page anew, since a page holds its own locale's words alone.
- A page downloads only its locale's copies of its message chunks.
- A server route renders messages through the output's `middleware`, as any server does (below), and its `Vary` names the headers the strategy read.

`examples/nuxt` is a complete app in English, Romanian and Arabic.

## Workers, Bun, Deno and Node

The output's `server.js` finds each request's locale by the config's `strategy` (`cookie`, `query`, `preferredLanguage`, `url`), binds it for everything the handler calls, and lists in the response's `Vary` the request headers it read, so a shared cache keeps a copy per locale:

```ts
// src/worker.ts
import { m } from "./lib/i18n/messages.js";
import { middleware } from "./lib/i18n/server.js";

export default {
	fetch: (request: Request) =>
		middleware(request, () => new Response(m.cart_title())),
};
```

Workers, Bun (`bun src/worker.ts`) and Deno (`deno serve src/worker.ts`) serve this module as it is. `examples/workers` is a complete Worker, and `test/workers.test.ts` serves it in all three. In Hono, which also runs on Node, the middleware is one line:

```ts
app.use((c, next) => middleware(c.req.raw, () => next().then(() => c.res)));
```

The locale stays bound while the handler runs and in every task it starts, so a page streamed as SvelteKit and React stream them renders in it to its last chunk. A stream's `pull()` is different: once the middleware has returned, the stream's reader starts it, outside the request. So on a server, a message rendered outside every request the middleware binds throws a `locale-unbound` GraiError rather than render in a locale that isn't the reader's. Render a stream in its `start()`, or in a task writing to it. Outside a request, pass `{ locale }` to the message, or run the code in `withLocale(locale, code)` from `server.js`, as a scheduled job does.

It needs `AsyncLocalStorage`, from `node:async_hooks`, which Node, Bun and Deno have. Workers have it by default from compatibility date 2026-08-04; on an earlier date, add the `nodejs_als` compatibility flag, which adds only that.
