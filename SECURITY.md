# Security

Please don't report security problems in public issues.

Use **Report a vulnerability** on the [Security tab](https://github.com/Tanmay-Mhatre/rawjobs/security) of this repo. Include what you found, how to reproduce it, and what it could affect. You'll get a reply within 7 days.

In scope: the app, the CLI, the contribution inbox (`services/contribute`), and the workflows that publish the shared directory. Out of scope: the hiring systems and job boards RawJobs reads.

## Releases and updates

The install line and the updater only accept a release whose `latest.json` is signed with RawJobs'
release key (ed25519; the public half is in `packages/core/src/release.ts` and both installers), and
only a bundle or a Node download with the SHA-256 that signed file names. The private key is a
GitHub Actions secret used by the release workflow; the maintainer keeps a copy off GitHub. If it
ever leaks, a release signed with the old key will move installs to a new one. Details:
[docs/install.md](docs/install.md#security).

The local server answers on `127.0.0.1` only, and refuses requests from other websites (it checks
`Host` and `Origin`).

RawJobs keeps your profile and tokens on your computer. If a change could send anything about a user over the network, that's a security bug too.
