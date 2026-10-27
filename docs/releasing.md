# Releasing

The owner publishes grai to npm, as `@xyrolle/grai`, from his own machine, confirming each publish with his account's two-factor authentication. The steps below are for 0.1.0; a later release swaps in its own version.

The release's pull request has already set the version in `package.json` and written the release's section at the top of `CHANGELOG.md`, headed `## 0.1.0 (unreleased)` (AGENTS.md, Releases).

## The steps

1. **Date the changelog.** On a branch from `main`, change `## 0.1.0 (unreleased)` to the day's date, as in `## 0.1.0 (2026-11-02)`. Commit it as `chore: release 0.1.0` and merge it.

   Check: the pull request changes that one line.

2. **Start from that commit, with a clean tree.**

   ```sh
   git switch main && git pull --ff-only
   git status --short
   git log -1 --format=%s
   node -p 'require("./package.json").version'
   node --version
   ```

   Check:
   - `git status` prints nothing.
   - The last commit is `chore: release 0.1.0`.
   - The version is `0.1.0`.
   - Node is 24, the LTS that CI's checks run on.

3. **Run the gate.** Install the dependencies as the lockfile pins them, then run every check CI runs:

   ```sh
   pnpm install --frozen-lockfile
   pnpm check && pnpm typecheck && pnpm build && pnpm check:package && pnpm size && pnpm test:performance && pnpm test
   ```

   Check:
   - Each command passes. The tests drive Chromium: if it is missing, run `pnpm exec playwright-core install chromium` once.
   - `pnpm check:package` prints publint's "All good!".
   - In the table from @arethetypeswrong, every entry passes under `node16` from ESM and under `bundler`. It ignores `node10` and `node16` from CommonJS, because grai ships ESM alone.

4. **Pack the tarball.** This is the exact file that gets published. Its `prepack` script builds `dist` again from this commit.

   ```sh
   npm pack
   tar -tzf xyrolle-grai-0.1.0.tgz | grep -v '^package/dist/'
   ```

   Check:
   - The file is `xyrolle-grai-0.1.0.tgz`, about 400 kB, with about 490 files.
   - Apart from `dist/`, the tarball holds only `package.json`, `README.md`, `LICENSE`, `CHANGELOG.md`, `SECURITY.md` and `config.schema.json`.

5. **Tag the commit and push the tag.**

   ```sh
   git tag -a v0.1.0 -m "grai 0.1.0"
   git push origin v0.1.0
   ```

   Check: `git ls-remote --tags origin v0.1.0` lists the tag.

6. **Sign in to npm.**

   ```sh
   npm whoami
   ```

   Check: it prints the owner's npm username. If it doesn't, run `npm login`. It opens npmjs.com in the browser and signs this machine in for two hours.

7. **Publish the tarball.**

   ```sh
   npm publish xyrolle-grai-0.1.0.tgz
   ```

   npm runs no scripts when it publishes a tarball, so it publishes exactly the bytes that steps 3 and 4 checked. A scoped package is restricted by default, and `publishConfig` makes it public. npm lists the tarball's contents, then asks for the second factor: in the browser, with a security key or an authenticator, or as a one-time code passed with `--otp=<code>`.

   Check: the output ends with `+ @xyrolle/grai@0.1.0`.

8. **Check what the registry serves.**

   ```sh
   npm view @xyrolle/grai dist-tags.latest
   npm view @xyrolle/grai@0.1.0 dist.shasum
   shasum xyrolle-grai-0.1.0.tgz
   cd "$(mktemp -d)" && npx -y @xyrolle/grai@0.1.0 help
   ```

   Check:
   - `latest` is `0.1.0`.
   - The registry's shasum is the tarball's.
   - `grai help` lists the commands.

9. **Create the GitHub release,** with the changelog's section as its notes:

   ```sh
   awk '/^## 0\.1\.0 /{on=1; next} /^## /{on=0} on' CHANGELOG.md > notes.md
   gh release create v0.1.0 --verify-tag --title "0.1.0" --notes-file notes.md
   rm notes.md
   ```

   Check: <https://github.com/xyrolle/grai/releases/tag/v0.1.0> shows the section, marked Latest.

10. **Lock publishing down. This is needed once, after the first publish.** On npmjs.com, open the package's Settings, then Publishing access, and choose "Require two-factor authentication and disallow tokens". After that, no token can publish grai: only a session confirmed with the second factor can, or a trusted publisher if one is ever added.

## Two ways to publish

### From this machine, with two-factor authentication

This is what the steps above do. On npmjs.com, it needs:
- two-factor authentication on the account, for authorization and writes (Account, then Two-Factor Authentication). A security key is best.
- after the first publish, the package's publishing access set to "Require two-factor authentication and disallow tokens" (step 10).

Trade-offs:
- Every publish needs the owner and his second factor. Nothing can publish grai without him, and there is no token to steal.
- There is no workflow or CI credential to guard.
- The release is built on a workstation. Steps 2 to 4 pin it to a clean checkout of the tagged commit, the lockfile and the gate.
- There is no provenance. npm generates provenance only from a supported cloud CI, so the package's page shows none.

### From GitHub Actions, as a trusted publisher, with provenance

A workflow that runs on a pushed `v*` tag publishes with a short-lived OIDC credential that npm issues to that workflow alone. npm then adds a provenance attestation, which ties the tarball to the repository, the commit and the run that built it.

Set-up:
1. **The package must already exist on npm.** npm's [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust) docs say so, so 0.1.0 is published from this machine whichever way later releases go.
2. **A workflow,** such as `.github/workflows/publish.yml`. It:
   - runs on `push` of tags `v*`;
   - has the permissions `contents: read` and `id-token: write`;
   - runs Node 24 (trusted publishing needs npm 11.5.1 or later and Node 22.14 or later);
   - runs `pnpm install --frozen-lockfile`, then the gate, then `npm publish`. Provenance needs no flag.

   A GitHub environment, such as `npm`, with the owner as its required reviewer, holds each run until he approves it.
3. **On npmjs.com,** open the package's Settings, then Trusted Publisher, then GitHub Actions. Enter the user `xyrolle`, the repository `grai`, the workflow filename `publish.yml` and the environment `npm`.

   The CLI can do the same: `npm trust github @xyrolle/grai --file publish.yml --repo xyrolle/grai --env npm --allow-publish`, with npm 11.15 or later. The configuration expires unless a publish through it succeeds within 2 days.
4. **Restrict publishing access** to "Require two-factor authentication and disallow tokens". That leaves the trusted publisher and sessions confirmed with the second factor.
5. **On GitHub, add a tag ruleset** so that only the owner can create `v*` tags, since a pushed tag publishes.

Trade-offs:
- With provenance, anyone, and `npm audit signatures`, can verify where each version was built, and npmjs.com shows it.
- There is no long-lived token, and the build runs on a clean runner.
- Whoever can push a `v*` tag or change the workflow can publish, unless the environment's reviewer approves each run. Every action and dependency the publish job runs could publish too, so actions are pinned by commit.
- npm binds the publisher to the repository's name. If `xyrolle/grai` is ever renamed, transferred or deleted, revoke the binding (`npm trust list`, `npm trust revoke`) and make it again. Otherwise whoever takes the old name could publish.
- Each release depends on GitHub Actions running.

### Recommendation

Publish from this machine, with two-factor authentication. For 0.1.0 it is the only way, because a trusted publisher can only be set up for a package that already exists. grai has one maintainer, who publishes each release himself. This way, publishing sits behind his second factor alone, and there is nothing in CI to guard.

Switch to trusted publishing if provenance becomes worth a workflow, or if someone else starts publishing. That change is the workflow, the set-up above, and step 7 becoming a pushed tag.
