# Hiring systems

RawJobs reads jobs from the hiring systems (applicant tracking systems, or ATS) and public job
boards listed below. Paste a company's careers link into **Companies → Add by link** in the dashboard, or into
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
| SAP SuccessFactors | `career{N}.successfactors.com/career?company={id}` (or `.eu`), or a career site such as `jobs.acme.com/search/` | XML listing feed; career sites: search pages (classic and tile templates) |
| Taleo | `{host}.taleo.net/careersection/{section}/jobsearch.ftl` | career-section search API |
| iCIMS | `careers-{slug}.icims.com/jobs` | portal search pages |
| Jobvite | `jobs.jobvite.com/{slug}` | careers search pages |
| JazzHR | `{slug}.applytojob.com/apply` | careers page |
| Zoho Recruit | `{slug}.zohorecruit.com/jobs/{page}` | data embedded in the careers page |
| JOIN | `join.com/companies/{slug}` | data embedded in the careers page |
| Paylocity | `recruiting.paylocity.com/Recruiting/Jobs/All/{id}` | data embedded in the careers page |
| Paycom | `www.paycomonline.net/v4/ats/web.php/portal/{key}/career-page` | careers-portal API |
| Hireology | `careers.hireology.com/{slug}` | careers API |
| UKG Pro Recruiting | `recruiting.ultipro.com/{code}/JobBoard/{board}` | job-board search API |
| Eightfold AI | `{company}.eightfold.ai/careers` (or the company's own domain) | careers-site API |
| Phenom | the company's own careers site, e.g. `careers.{company}.com` | careers-site search API |
| CareerPlug | `{slug}.careerplug.com/jobs` | careers page |
| Dayforce | `jobs.dayforcehcm.com/{lang}/{client}/{board}` | careers-site API |
| ADP Workforce Now | `workforcenow.adp.com/mascsr/default/mdf/recruitment/recruitment.html?cid={id}` | career-center API |
| ApplicantPro / iSolved Hire | `{slug}.applicantpro.com/jobs` or `{slug}.isolvedhire.com/jobs` | careers-site API |
| Paycor Recruiting | `recruitingbypaycor.com/career/CareerHome.action?clientId={id}` | careers page |
| HiringThing | `{slug}.hiringthing.com` (and its resellers' domains) | careers page |
| Manatal | `www.careers-page.com/{slug}` | open API |
| Trakstar Hire | `{slug}.hire.trakstar.com` | job feed |
| Factorial | `{slug}.factorialhr.com` (or `.factorial.es`, `.factorial.it`, …) | careers page |
| Gem | `jobs.gem.com/{board}` | board GraphQL API |
| HRMDirect (ClearCompany) | `{slug}.hrmdirect.com/employment/` | openings page |
| softgarden | `{slug}.career.softgarden.de` | JSON job feed |
| Cornerstone OnDemand | `{tenant}.csod.com/ux/ats/careersite/{n}/home` | careers-site API |
| Keka | `{slug}.keka.com/careers` | careers API |
| Taleo Business Edition | `{pod}.tbe.taleo.net/{pod}{NN}/ats/careers/v2/searchResults?org={ORG}&cws={N}` | RSS feed |
| JobScore | `careers.jobscore.com/careers/{slug}` | JSON job feed |
| Avature | `{tenant}.avature.net/{portal}` | careers search pages |
| PageUp | `careers.pageuppeople.com/{client}/cw/en/listing/` | RSS feed |
| Radancy (TalentBrew) | the company's own careers site (e.g. `jobs.boeing.com`) | sitemap, plus each job's page |
| Oleeo | `{tenant}.tal.net/vx/.../candidate/jobboard/vacancy/1/adv/` | job board pages |
| Jobtrain | the employer's own Jobtrain site (e.g. `apply.jobs.scot.nhs.uk`) | job card pages |
| Varbi | `{tenant}.varbi.com` | RSS feed, plus each job's page |
| ReachMee | `web103.reachmee.com/ext/{iid}/{customer}/main?site={n}` | job list page |
| Jobylon | `emp.jobylon.com/companies/{id}-{slug}/` | embed job list |
| Homerun | `{slug}.homerun.co` | Atom job feed |
| Emply | `{tenant}.career.emply.com` | careers-site API |
| Bullhorn | a Bullhorn career portal (any host serving `/app.json`) | public REST API |
| HRMOS | `hrmos.co/pages/{company}/jobs` | job list pages |
| HERP | `herp.careers/v1/{company}` | job list page |
| engage | `en-gage.net/{company}/` | job list page |

iCIMS, Jobvite, JazzHR and several smaller systems (CareerPlug, Paycor, HiringThing, Factorial, HRMDirect) have no keyless feed, so their connectors read the public careers pages. If a company changes its page template, that connector may need an update.

Most connectors use endpoints the vendor never documented, so a change on their side shows up as zero
jobs rather than an error. Once a day the **Connectors · health** workflow
(`.github/workflows/connector-health.yml`, script `scripts/catalog/connector-health.ts`, locally
`pnpm connector:health [--only workday,lever]`) tries up to 3 live boards per hiring system from the
latest published directory (most open jobs, spread over shards) and each job board once, with the real
connector. A system fails when none of its boards gives jobs with a title, link and id, and warns when
some don't; systems with no live board in the directory are skipped. Failures open one "Hiring system
checks failing" issue, which closes itself once none fails; the full table is in the run's summary.

Public job boards: Hacker News "Who is hiring", Remotive, Arbeitnow, Remote OK, Himalayas, Jobicy, We Work Remotely and Remote First Jobs, added the same way,
by pasting their link.

The connectors are in [`packages/core/src/connectors/`](../packages/core/src/connectors/). Each one
reads the same public jobs a visitor to the careers page sees, politely (see
[Fair use](../README.md#fair-use)). A system missing here? [Suggest it](https://github.com/Tanmay-Mhatre/rawjobs/issues/new?template=feature_request.yml).
