# grai

Translations compiled ahead of time into plain functions, for any JavaScript framework.

*Grai* (Romanian) is a people's way of speaking.

grai is under construction and not yet published. The goal: drop-in for Paraglide's catalogs and `m.key(inputs)` calls, much faster to build and to edit, with only the reader's locale in the browser.

## Testing

Browser tests set the locale they expect in `beforeEach`, with `setLocale(locale, { reload: false })`, which sets `<html lang>` and `dir` and the locale the next messages render in.

The runtime reads `<html lang>` once, when it loads, so that a message call never touches the DOM. A test that changes `lang` itself leaves the locale as it was.

## License

MIT
