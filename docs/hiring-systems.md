# Hiring systems

RawJobs reads jobs from 23 hiring systems (applicant tracking systems, or ATS) and 4 public job
boards. Paste a company's careers link into **Companies → Add by link** in the dashboard, or into
`rawjobs detect`, and RawJobs works out which system it is.

| ATS | Careers URL looks like | Read from |
| --- | --- | --- |
| Greenhouse | `job-boards.greenhouse.io/{slug}` | public API |
| Lever | `jobs.lever.co/{slug}` (EU: `jobs.eu.lever.co`) | public API |
| Ashby | `jobs.ashbyhq.com/{slug}` | public API |
| SmartRecruiters | `careers.smartrecruiters.com/{slug}` | public API |
| Workday | `{tenant}.wd{N}.myworkdayjobs.com/{site}` | careers-site API (20 per page, capped at 2,000 jobs) |
| Workable | `apply.workable.com/{slug}` | widget feed |
| Recruitee | `{slug}.recruitee.com` | careers-site API |
| Personio | `{slug}.jobs.personio.com` (or `.de`) | XML feed |
| BambooHR | `{slug}.bamboohr.com/careers` | careers-page JSON |
| Breezy HR | `{slug}.breezy.hr` | careers-page JSON |
| Teamtailor | `{slug}.teamtailor.com/jobs` | RSS feed |
| Pinpoint | `{slug}.pinpointhq.com` | careers-site JSON |
| Rippling | `ats.rippling.com/{slug}/jobs` | board API |
| HiBob | `{slug}.careers.hibob.com` | careers-page API |
| Freshteam | `{slug}.freshteam.com/jobs` | widget feed |
| Comeet | `www.comeet.com/jobs/{company}/{uid}` | data embedded in the hosted page |
| Oracle Recruiting | `{pod}.fa.{dc}.oraclecloud.com/hcmUI/CandidateExperience/en/sites/{site}` | candidate-experience API |
| SAP SuccessFactors | `career{N}.successfactors.com/career?company={id}` (or `.eu`) | XML listing feed |
| Taleo | `{host}.taleo.net/careersection/{section}/jobsearch.ftl` | career-section search API |
| iCIMS | `careers-{slug}.icims.com/jobs` | portal search pages |
| Jobvite | `jobs.jobvite.com/{slug}` | careers search pages |
| JazzHR | `{slug}.applytojob.com/apply` | careers page |
| Zoho Recruit | `{slug}.zohorecruit.com/jobs/{page}` | data embedded in the careers page |

iCIMS, Jobvite and JazzHR have no keyless feed, so their connectors read the public careers pages. If a company changes its page template, that connector may need an update.

Public job boards: Hacker News "Who is hiring", Remotive, Arbeitnow, Remote OK, Himalayas and Jobicy, added the same way,
by pasting their link.

The connectors are in [`packages/core/src/connectors/`](../packages/core/src/connectors/). Each one
reads the same public jobs a visitor to the careers page sees, politely (see
[Fair use](../README.md#fair-use)). A system missing here? [Suggest it](https://github.com/Tanmay-Mhatre/rawjobs/issues/new?template=feature_request.yml).
