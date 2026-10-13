# Contributing

Thanks for helping. Small, focused pull requests are easiest to review. Everyone taking part agrees to the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Set up

Requires Node 22+ and [pnpm](https://pnpm.io).

```bash
pnpm install
pnpm hooks:install   # once per clone: no direct pushes to main, and pnpm check before every push
pnpm check           # lint + format check + design tokens + design lint + typecheck + tests
pnpm format          # format, and apply Biome's safe lint fixes
git config blame.ignoreRevsFile .git-blame-ignore-revs   # once: git blame skips formatting-only commits
```

The copy people install is a bundle that needs only Node: `pnpm bundle` builds it in
`dist/bundle/`, and `pnpm bundle --try <folder>` lays it out as an installed copy so you can run
`<folder>/bin/rawjobs serve`. To try the installer and updates end to end, make test releases
signed with a throwaway key, as CI does (`release-files` in `.github/workflows/ci.yml`):
`pnpm release:files --key <key.pem> --public-key <base64>`, plus `pnpm bundle --version <v>` and
`--broken` for a newer and a broken version. See `docs/install.md` and `docs/plans/local-install.md`.

The contribution inbox (`services/contribute`) is a Cloudflare Worker in the same pnpm workspace:
`pnpm install` sets it up, and `pnpm test` and `pnpm typecheck` cover it with the rest.

## Pull requests

- Branch from `main` and open a pull request. `main` is protected: CI's `check` and the install
  test (install, update, go back, uninstall on Windows, macOS and Linux) must pass before it can
  merge.
- Pull requests merge through a merge queue (Mergify), one at a time, in the order they joined.
  The maintainer adds the `queue` label when yours is ready; Mergify brings it up to date with
  `main`, waits for CI and merges it. If it conflicts with `main` or CI fails, Mergify says so on
  the pull request and takes it out of the queue until it's fixed.
- Releases are made by the maintainer with a version tag (see [README → Development](README.md#development)).
- Add or update tests. Connector tests use saved responses in `packages/core/test/fixtures`, so
  tests never hit live sites.
- Write user-facing text in plain English: short sentences, no jargon, no marketing tone.
- Never commit a personal config, resume or token. `rawjobs.config.local.yaml`, `profile/` and
  `data/` are gitignored for this reason.

## Rules that keep the project safe to run

- **No telemetry.** Don't add analytics, crash reporting or any call that sends data about the
  user. If a change sends anything new over the network, update [PRIVACY.md](PRIVACY.md) in the
  same pull request.
- **Be polite to job boards.** Read only public postings, keep the per-host delays, identify with
  the User-Agent, back off on rate limits, and never touch apply endpoints.
- **Data licences.** Only add sources to the shared directory whose licence allows it (see
  `services/directory-repo-template/NOTICE.md`). Public job boards (Hacker News, Remotive, Arbeitnow,
  Remote OK, Himalayas, Jobicy) are fetched on the user's computer only, never published.

## Adding a company

Use **Add by link** in the app (shared with the directory if sharing is on), or add it to
`scripts/catalog/seeds/industries.json` in a pull request.

## Reporting

- Questions and ideas: [Discussions](https://github.com/Tanmay-Mhatre/rawjobs/discussions).
- Bugs: open an issue with the **Bug report** template.
- Something RawJobs should do: the **Feature request** template.
- A company that wants to be removed from the directory: the **Remove a company** template. We
  reply within 7 days.
- Security problems: don't open a public issue. See [SECURITY.md](SECURITY.md).

## License

RawJobs is MIT licensed ([LICENSE](LICENSE)). By opening a pull request you agree that your
contribution is released under the same license.
