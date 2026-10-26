# Migrating from i18next, next-intl or FormatJS

Two commands move an app's messages and its calls:

```sh
grai import --from i18next locales   # or --from icu, for next-intl and FormatJS
grai migrate
grai compile
```

- **`grai import`** writes the grai catalogs, and `grai.import.json` beside the config. That file maps each key as the app's calls name it to its grai key and the inputs it takes, so any tool can migrate a call by looking it up.
- **`grai migrate`** rewrites each call that names its message plainly as a call of the grai message, and imports `m` from the outdir's `messages.js`. Once every call of a `t` or an `intl` is rewritten, it removes the hook call that gave it, its place in React's hook dependencies, and the imports nothing uses. Every other call is listed with its file, line and the reason, and stays as it is: a call it cannot read for certain is never guessed. It writes every file or none, and a second run changes nothing it has done. `--source <dir>` limits it to some directories.
- **A call it cannot prove safe stays as it is**, with a note. That covers a locale or a default value that may read otherwise once the rewrite moves or drops it, an `m` that names another import, and a list a hook that is not React's takes.
- **What is left** is the list it prints: the calls to migrate by hand, then the library's own API, such as its provider, its setup and its locale switch, which grai's runtime and middleware replace.

`grai migrate` reads JavaScript and TypeScript modules, JSX included, with grai's parser, oxc's. It lists each Svelte, Vue, Astro or MDX component that imports the library, for a person to migrate.

Each library has a small app in `bench/migrate/`. `node bench/migrate-equivalence.mjs` imports and migrates each one, then renders its pages before and after, for three locales and 30 sets of inputs, and fails on any difference.

## From i18next and react-i18next

`grai import --from i18next locales` reads `locales/<locale>.json`, or `locales/<locale>/<namespace>.json`.

| The call | Becomes |
| --- | --- |
| `t("cart:title")`, `i18next.t("title", { ns: "cart" })` | `m.cart_title()` |
| `const { t } = useTranslation("cart")`, then `t("items", { count })` | `m.cart_items({ count })` |
| `const [t] = useTranslation(["cart", "common"], { keyPrefix: "summary" })`, then `t("total", { sum })` | `m.cart_summary_total({ sum })` |
| `t("friend", { context: "male" })` | `m.common_friend_male()` |
| `t("place", { count, ordinal: true })` | `m.common_place_ordinal({ count })` |
| `t("greeting", { name, lng })` | `m.common_greeting({ name }, { locale: lng })` |

- **A call that names no namespace** reads i18next's default one, `translation`. An app that sets `defaultNS` passes it: `grai migrate --default-namespace common`.
- **A hook given several namespaces** loads them all but looks in the first, as react-i18next does, unless it passes `nsMode: "fallback"`. A key only another namespace has is listed with the call to write, should the app's `fallbackNS` reach it; so is a key that names a namespace the hook does not load.
- **Left for a person:**
  - a key, namespace or context that is an expression;
  - options that are not an object written in the call;
  - i18next's own options, such as `returnObjects` and `postProcess`;
  - a `t` passed to another component or function;
  - `<Trans>`. grai import keeps an i18next message's tags as text, so a message `<Trans>` renders needs its tags written as grai markup, `{#b}…{/b}`, in each catalog; its `.parts()` then render with `grai/react`'s `Markup`.
- **A call that misses an input** the message reads, or passes one it does not read, is listed too. i18next renders `{{name}}` or ignores the input; grai's types reject both.

## From next-intl

`grai import --from icu messages` reads `messages/<locale>.json`.

| The call | Becomes |
| --- | --- |
| `const t = useTranslations("Home")`, then `t("greeting", { name })` | `m.Home_greeting({ name })` |
| `const t = useTranslations()`, then `t("About.title")` | `m.About_title()` |
| `const t = await getTranslations("About")`, then `t("title")` | `m.About_title()` |
| `const t = await getTranslations({ locale, namespace: "About" })`, then `t("visits", { count })` | `m.About_visits({ count }, { locale })` |

- **The `await` goes with `getTranslations`.** Once every call of its `t` is rewritten, `const t = await getTranslations(…)` is removed, so the function no longer yields there, and the code after it runs in the same turn. That matters only to code that counts on the pause. For example, when several such functions run side by side, their work after that line interleaves in another order. It also matters when a call outside a request relied on `getTranslations` throwing there.
- **Left for a person:**
  - `t.rich` and `t.markup`, whose markup renders through the message's `.parts()`;
  - `t.raw` and `t.has`: grai's messages are functions, and a missing key fails the build;
  - a call that passes formats, and a key or namespace that is an expression.
- **The rest of next-intl** is listed too: `NextIntlClientProvider`, `useLocale`, `getMessages` and its navigation helpers, which grai's runtime and middleware replace.

## From FormatJS and react-intl

`grai import --from icu lang` reads `lang/<locale>.json`: each id's message, or the descriptors `formatjs extract` writes, `{ "defaultMessage", "description" }`.

| The call | Becomes |
| --- | --- |
| `intl.formatMessage({ id: "shop.title", defaultMessage: "Shop" })` | `m.shop_title()` |
| `const { formatMessage } = useIntl()`, then `formatMessage({ id: "cart.items" }, { count })` | `m.cart_items({ count })` |
| `<FormattedMessage id="shop.greeting" values={{ name }} />` | `{m.shop_greeting({ name })}` |

- **Left for a person:**
  - a descriptor that is not written in the call, such as `defineMessages`' `messages.title` or `{...descriptor}`;
  - an id that is an expression;
  - a message with markup, or values that render it, whose markup renders through the message's `.parts()`;
  - `<FormattedMessage>`'s `tagName` and its children.
- **The rest of react-intl** is listed too: `IntlProvider`, `createIntl`, `injectIntl` and `intl.formatNumber`.
- **`<FormattedMessage>` renders its text alone** unless the provider sets `textComponent`, and so does the call that replaces it.
