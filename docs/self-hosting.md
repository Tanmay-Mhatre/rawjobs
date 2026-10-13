# Self-hosting and maintenance

This page is for two groups: people running a fork with their own data, and the maintainers of the
central directory. For how the directory works, see [shared-directory.md](shared-directory.md).

## Using a fork

A fork works out of the box: it downloads the central directory and shares boards with the
central inbox, like any other install. You only need the steps below if you want your own data.

### Point the app at your own data

Three environment variables, read by the CLI and the local server (`packages/core/src/directory.ts`):

| Variable | Default | What it is |
|---|---|---|
| `RAWJOBS_DIRECTORY_URL` | `https://github.com/Tanmay-Mhatre/rawjobs-directory/releases/latest/download` | Where `manifest.json`, `directory.json.gz` and `index.json.gz` are downloaded from. |
| `RAWJOBS_CONTRIBUTE_URL` | `https://rawjobs-contribute.rawjobs.workers.dev` | The contribution inbox that shared boards are sent to. Set it to an empty string to send nothing. |
| `RAWJOBS_JOBS_URL` | `https://github.com/Tanmay-Mhatre/rawjobs-directory/releases/download/jobs` | The shared daily job feed that scans use to skip companies with nothing for you (`packages/core/src/job-feed.ts`). |
| `RAWJOBS_DATA_PUBLIC_KEY` | `DATA_PUBLIC_KEY` in `packages/core/src/data-signing.ts` | The key the directory's and the job feed's manifests must be signed with. Set it to your own key's public half when you point the two URLs above at your own data. |

For example:

```bash
RAWJOBS_DIRECTORY_URL=https://github.com/you/your-directory/releases/latest/download \
RAWJOBS_CONTRIBUTE_URL=https://your-inbox.you.workers.dev \
pnpm start
```

To make it permanent for everyone using your fork, change `DEFAULT_DIRECTORY_URL` and
`DEFAULT_CONTRIBUTE_URL` in `packages/core/src/directory.ts` instead. Installed copies need this:
the computer starts their server at log in, without your terminal's environment variables.

### Publish your own releases

Out of the box, a fork's installers and installed copies download **this** repository's releases
and accept only releases signed with **its** key. To ship your own installs and updates:

1. Make a signing key pair (ed25519), and keep the private key safe:

   ```bash
   node -e "const {generateKeyPairSync}=require('crypto');const {publicKey,privateKey}=generateKeyPairSync('ed25519');console.log(publicKey.export({type:'spki',format:'der'}).toString('base64'));require('fs').writeFileSync('release-signing-key.pem',privateKey.export({type:'pkcs8',format:'pem'}),{mode:0o600})"
   ```

2. Put the public key (the line it prints) in `RELEASE_PUBLIC_KEY` in `packages/core/src/release.ts`
   and in `packaging/install.sh` and `packaging/install.ps1` (a test checks all three match).
3. Point the code at your repository: `RELEASE_URL` in `packages/core/src/release.ts`, `REPO` in
   `packages/core/src/update.ts`, the `Release` address in both installers, and the install lines in
   `README.md`, `docs/install.md` and `apps/site/src/index.html`.
4. Add the private key as the `RAWJOBS_SIGNING_KEY` Actions secret
   (`gh secret set RAWJOBS_SIGNING_KEY < release-signing-key.pem`).
5. Set the version in `package.json`, merge, and push an annotated `v*` tag. The release workflow
   builds, signs, test-installs and publishes it (see [README → Development](../README.md#development)).

### Run your own directory

1. Create a public repo for the data and copy in `services/directory-repo-template/`. Keep
   `LICENSE-DATA` and `NOTICE.md`: the sources' licences require the credits.
2. Deploy your own inbox from `services/contribute` (step 4 of
   [One-time setup](shared-directory.md#one-time-setup)). Use your own KV namespace id in
   `wrangler.toml`.
3. In your fork, set the repository variable `DATA_REPO` to your data repo, and the secrets
   `INBOX_URL`, `INBOX_TOKEN` and `DATA_REPO_TOKEN` (see [Tokens](#tokens)).
4. Make a data signing key the same way as the release key above (call the file
   `data-signing-key.pem`). It must be a different key: the data workflows run every day on crawled
   data, and a leak there must not be able to sign an app update. Put its public half in
   `DATA_PUBLIC_KEY` in `packages/core/src/data-signing.ts` and the private key in the
   `RAWJOBS_DATA_SIGNING_KEY` secret (`gh secret set RAWJOBS_DATA_SIGNING_KEY < data-signing-key.pem`).
   Apps refuse a directory or job feed whose manifest isn't signed with it.
5. Enable Actions in your fork. GitHub turns them off in new forks until you do.

### Rules for forks

- **Never run the contributions workflow against the central inbox.** Only the central directory's
  workflow may read and acknowledge it. Acknowledging removes boards, so a second poller would
  quietly take other users' contributions away from the central directory. The central inbox
  token is never shared.
- Keep the public job boards (Hacker News, Remotive, Arbeitnow, Remote OK, Himalayas) out of any data
  you publish. They are fetched on each user's own computer only.
- Honour `denylist.json`: companies removed on request in the central directory should stay out of
  yours too.
- Keep a contact URL in the User-Agent of anything that polls job boards on a schedule.

## Maintainers and tokens

The project has one maintainer today. A second maintainer should have:
- admin on `rawjobs` and `rawjobs-directory`;
- access to the Cloudflare account that runs the inbox;
- a line in `.github/CODEOWNERS`.

### Tokens

| Secret | Where it lives | What it can do |
|---|---|---|
| `DATA_REPO_TOKEN` | GitHub secret in `rawjobs` | Push to `rawjobs-directory` and publish its releases. |
| `INBOX_TOKEN` | Cloudflare Worker secret **and** GitHub secret in `rawjobs` (same value) | Read and acknowledge waiting contributions. |
| `INBOX_URL` | GitHub secret in `rawjobs` | Not secret, kept with the token for convenience. |
| `RAWJOBS_DATA_SIGNING_KEY` | GitHub secret in `rawjobs` | Sign the directory's and the job feed's manifests (`scripts/catalog/sign.mjs`). Not the release key: it can't sign an app update. |

Rotate the two tokens every 90 days, when a maintainer leaves, and right away if one may have leaked.
The data signing key changes only with an app release (installed apps carry its public half): put the
new public half in `data-signing.ts`, release the app, then switch the secret once most installs have updated.

### Rotate `DATA_REPO_TOKEN`

Use a **fine-grained** personal access token, never a classic one.

1. GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token.
   - Resource owner: the account that owns `rawjobs-directory`.
   - Expiration: 90 days.
   - Repository access: **only** `rawjobs-directory`.
   - Permissions: *Contents: Read and write* (pushes and releases). Nothing else.
2. In `rawjobs`: `gh secret set DATA_REPO_TOKEN` and paste the new token.
3. Run **Directory · contributions** by hand (Actions → Run workflow) and check it passes. If the
   inbox is empty it stops early, so also check the next **Directory · weekly rebuild**, or run it by hand.
4. Delete the old token on the same GitHub page.
5. Put the new expiry date in your calendar, a week early. GitHub also emails before a token
   expires. Once it has expired, the weekly rebuild and contribution runs fail.

### Rotate `INBOX_TOKEN`

This is a random string shared by the Worker and the workflow, not a GitHub token.

1. Make a new one: `openssl rand -hex 32`.
2. Right after a contributions run (they start at 17 minutes past every third hour, UTC), set it
   in both places:
   - `cd services/contribute && npx wrangler secret put INBOX_TOKEN`
   - `gh secret set INBOX_TOKEN` in `rawjobs`
3. Run **Directory · contributions** by hand and check the "Check the inbox" step passes.

Until both are updated, the workflow fails with 401 and contributions wait in the inbox (up to 30
days), so nothing is lost.

### If a token leaks

1. Revoke it first (delete the GitHub token, or put a new `INBOX_TOKEN` on the Worker), then
   rotate as above.
2. `DATA_REPO_TOKEN`: check recent commits and releases in `rawjobs-directory` for anything
   you didn't publish, and revert it.
3. `INBOX_TOKEN`: someone could have read or acknowledged waiting boards. Boards are not personal
   data, so the worst case is lost contributions; users' apps don't resend them.
