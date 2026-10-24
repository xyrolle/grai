# Security

## Reporting a vulnerability

Report it privately, through **Report a vulnerability** on the repository's [Security tab](https://github.com/xyrolle/grai/security). Please don't open a public issue for it.

Say what an attacker controls, what grai then does, and how to reproduce it: a catalog, a config or a translation file, and the commands that show it.

## What counts

grai compiles catalogs into the JavaScript apps run, and its middleware reads every request, so these count:
- a catalog, or a translation merged with `grai merge`, that makes the compiler write code other than the message's text;
- a request whose cookie, URL or `Accept-Language` header makes the server's middleware do anything other than pick one of the project's locales;
- a file that grai reads or writes outside the project's catalogs and its `outdir`.

## Supported versions

Fixes go into the latest release.
