# RawJobs company directory

A shared, weekly-rebuilt list of companies and their public job boards on the hiring systems RawJobs
reads (see [the list](https://github.com/Tanmay-Mhatre/rawjobs/blob/main/docs/hiring-systems.md)), used by [RawJobs](https://github.com/Tanmay-Mhatre/rawjobs) installs
for company suggestions and browsing.

## Files

- **Releases → latest**: `manifest.json` (version, counts, SHA-256 of each file), `directory.json.gz`
  (every live or dormant company), `index.json.gz` (open job titles and locations per company).
- `contributions.json`: companies users added by link, each live-checked before it was accepted.
- `coverage.md`: how many must-have companies per industry can be tracked, and which hiring systems to support next.
- **Releases → jobs**: the job feed, rebuilt every 6 hours. `jobs-manifest.json` (schema version, SHA-256 of each shard)
  and one `jobs-<system>-<stamp>.json.gz` per hiring system: every live board's open jobs as job id,
  title, location, workplace and posted date. No descriptions. Apps use it to decide which companies
  to check live.
- `denylist.json`: companies removed on request. They are left out of every release.
- `LICENSE-DATA`: the data is CC BY 4.0. `NOTICE.md`: sources, credits and how to ask for a takedown.

## How it's built

Every Monday: public company-board lists (see NOTICE.md), the project's industry seed list and the
contributions are merged, every board is live-checked with the cheapest call its hiring system
offers, open roles are indexed, industries are tagged, and a new release is published. Contributions
arrive between rebuilds every 3 hours. The job feed is rebuilt every 6 hours; boards that haven't changed
cost one empty request.

No personal data is stored here: a contribution is a hiring system, a board name and a company name.

## Licence and takedowns

The data is licensed under [CC BY 4.0](LICENSE-DATA). Jobs from the public job boards an app user
can add (Hacker News "Who is hiring" (through Algolia's HN API), Remotive, Arbeitnow, Remote OK, Himalayas, Jobicy, We Work Remotely and Remote First Jobs) are never included. To have a company removed, see
[Takedown and opt-out](NOTICE.md#takedown-and-opt-out); we reply within 7 days.
