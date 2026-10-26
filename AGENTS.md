# grai: contributor guide

grai compiles translation catalogs ahead of time into plain functions, for any JavaScript framework. *Grai* is Romanian for a people's speech.

## Design invariants
- **Catalogs are the inlang message-format JSON, one file per locale.** Paraglide catalogs work unchanged, and selectors and plurals follow MessageFormat 2.
- **Every message compiles to a plain function, ahead of time.** Nothing is parsed at runtime, and the runtime has no dependencies.
- **The compiler writes the type declarations itself.** It never runs TypeScript to derive them.
- **A missing key fails the build.** A runtime 500 or a blank label is a bug in grai.
- **The output is written atomically and incrementally.** Editing one message rewrites only what it changes, and no reader ever sees a half-written output.
- **Nothing is fetched at build time.** No plugins are loaded from URLs.
- **The core knows no framework.** Vite, SvelteKit, Next.js and plain servers are thin adapters around it.
- **The current locale is resolved once per request or render, never per message call.**
- **The browser gets only its own locale's strings.**
- **Intl objects are created once per locale and options, and reused.**
- **Performance claims are measured.** Every one is backed by a benchmark in the repo, against Paraglide on real catalogs, and the README cites the numbers.

## Quality bar

The code is small, readable and maintainable by a stranger. Every line earns its place.

- **The smallest public API that covers the real use.** No option, flag, hook or extension point without a concrete user today. Adding one later is easy; removing one is a breaking change.
- **No abstraction without two real uses.** No factories, registries, plugin systems or generic layers "for later".
- **Short files, short functions and plain control flow.** A reader understands a function without scrolling or jumping between files.
- **Names say what a thing is in the domain.** No `utils`, `helpers` or `manager` dumping grounds.
- **No dead code, commented-out code or TODOs in `main`.** Open work goes in `docs/followups.md`.
- **Dependencies are a cost.** Runtime dependencies are the platform and the declared peer dependencies, nothing else, unless a review agrees otherwise.
- **Errors are typed and actionable.** A message says what went wrong and what to do; nothing is swallowed.
- **Tests are few, meaningful and readable.** Each one names a behaviour and fails for one reason. No generated matrices and no snapshot dumps.
- **Every change reaches `main` through a pull request, and nothing merges before review:**
  - one review for design, simplicity, soundness and clean code;
  - findings fixed first, as new commits on the PR branch;
  - then a rebase-merge, so the atomic commits land on `main` as they are.

## Working rules

### Commits and pull requests
- Every commit message is a single-line title with a conventional prefix (`feat:`, `fix:`, `perf:`, `refactor:`, `test:`, `docs:`, `chore:`). No body, no bullet points.
- One cause per commit. A commit carries the test that proves it: red before, green after.
- No `Co-Authored-By` trailer and no AI or tool attribution, in commits, pull request titles or descriptions.
- Never force push a shared branch. Changes after review go in as new commits.
- A pull request description says what was wrong or missing, what changed and how it was tested. Short, plain, and true to the code as it stands.

### Code
- The smallest change at the cause. Weigh the alternatives and pick the simplest one that fully solves the problem.
- No `as any`, no casts, no `@ts-ignore`/`@ts-expect-error` and no avoidable `!`. Model the type instead.
- Code reads at a glance. A chain that needs a comment becomes a named constant or a small named function. Comments say why, never what.
- A name that comes from outside, from a catalog, a file or the command line, is looked up in a `Map` or with `ownEntry` (`src/own-entry.ts`), and written to a `Map` or an object without a prototype. `table[name]` alone also finds what every object inherits, such as `constructor`, and `object[name] = value` with `__proto__` sets a prototype.
- No legacy or compatibility code. Delete what you replace in the same change; no fallbacks "for old callers", no aliases.
- Public API changes are deliberate. Every exported name is documented and tested.

### Tests
- Tests exercise the real thing: the real compiler on real catalog files, a real Vite build, a real browser where a browser matters. No mocks where the real dependency can run.
- A test creates the data it needs and leaves nothing behind.
- No timing sleeps. Wait for an observable condition.

### Tooling
- pnpm only, with the version pinned in `packageManager`. Node 24 LTS.
- The latest stable, fastest tooling: Biome (lint and format), Vitest, and TypeScript 7 (`tsgo`) for type checking.
- `pnpm check`, `pnpm typecheck` and `pnpm test` all pass before a push.

### Releases
The owner publishes; nothing else does.
1. On a branch, write the release's section at the top of `CHANGELOG.md` from the `feat:`, `fix:` and `perf:` commits since the last tag (`git log --format=%s v<last>..HEAD`), in words for those who use grai. Run `pnpm version <version> --no-git-tag-version`, commit both as `chore: release <version>`, and merge it through a pull request.
2. On `main` at that commit: `git tag v<version>`, `git push origin v<version>`, then `pnpm publish`, whose `prepublishOnly` runs the whole gate first.

### Docs
- Docs record decisions and their reasons, not implementation retellings.
- Open follow-ups go in `docs/followups.md`, each with "done when"; delete an entry in the change that resolves it.
- The docs site (`site/`, Starlight) is built from the README's sections and the docs they point to, by `site/pages.ts`: nothing is written there by hand. `pnpm --filter grai-site build` fails on a dead link.
