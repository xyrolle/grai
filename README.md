# grai

Translations compiled ahead of time into plain functions, for any JavaScript framework.

*Grai* (Romanian) is a people's way of speaking.

grai is under construction and not yet published. The goal: drop-in for Paraglide's catalogs and `m.key(inputs)` calls, much faster to build and to edit, with only the reader's locale in the browser.

## SvelteKit

`grai/sveltekit`'s `handleLocale` renders each request in its locale, from the output's middleware and text direction. `examples/sveltekit` is a complete app.

```ts
// src/hooks.server.ts
import { handleLocale } from "grai/sveltekit";
import { getTextDirection } from "#lib/i18n/runtime.js";
import { middleware } from "#lib/i18n/server.js";

export const handle = handleLocale({ middleware, getTextDirection });
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

Links then name their locale with `localizeHref("/about")`.

## License

MIT
