# grai

Translations compiled ahead of time into plain functions, for any JavaScript framework.

*Grai* (Romanian) is a people's way of speaking.

grai is under construction and not yet published. The goal: drop-in for Paraglide's catalogs and `m.key(inputs)` calls, much faster to build and to edit, with only the reader's locale in the browser.

## Testing

Browser tests set the locale they expect in `beforeEach`, with `setLocale(locale, { reload: false })`, which sets `<html lang>` and `dir` and the locale the next messages render in.

The runtime reads `<html lang>` once, when it loads, so that a message call never touches the DOM. A test that changes `lang` itself leaves the locale as it was.

## Next.js

`grai/next` binds the locale in Next's App Router: the proxy resolves it, server components bind it, and client components get it on the server from `LocaleProvider` and in the browser from `<html lang>`. A message call stays a plain function. `examples/next` is a complete app.

```ts
// next.config.ts: `next build` compiles the catalogs, `next dev` recompiles on each save
import { withGrai } from "grai/next/config";

export default withGrai({ /* the app's own config */ });
```

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
- **Server actions and route handlers name the locale:** `m.saved({}, { locale })`. React keeps no request state there.
- **Per-key imports** (`import { title } from "#i18n/messages/title.js"`) map to the output's keys.js through package.json `imports`, as in the example.
- **A markup message** renders with `grai/react`'s `Markup`, in server and client components alike:

  ```tsx
  <Markup parts={m.terms.parts()} markup={{ link: (children) => <a href="/terms">{children}</a> }} />
  ```

On a page of 400 messages in a server component and 100 in a client component, the browser downloads 129.7 KB brotli against next-intl's 230.3 KB, or its 134.5 KB with the client's keys picked, and an edit to a catalog is written in 6 ms; the rest of the edit is Next's refresh (`bench/nextjs.mjs`, `docs/runtime.md`).

## License

MIT
