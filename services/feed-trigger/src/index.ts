/**
 * Starts the job feed workflow (.github/workflows/jobs-daily.yml) every 6 hours. GitHub's own cron
 * often starts runs hours late; this one is on time. When both fire, the workflow's first job skips
 * the second run (the feed is under 4 hours old), so nothing runs twice.
 *
 * Setup: see wrangler.toml. Needs one secret, GITHUB_TOKEN: a fine-grained token for the app repo
 * with "Actions: read and write" and nothing else.
 */

type Env = {
  GITHUB_TOKEN: string;
  /** owner/name of the repo with the workflow. */
  REPO: string;
  WORKFLOW: string;
  REF: string;
};

/** Ask GitHub to start the workflow on REF. Throws on anything but 204, so the failure shows in the Worker's logs. */
export async function dispatch(env: Env, fetchImpl: typeof fetch = fetch): Promise<void> {
  const url = `https://api.github.com/repos/${env.REPO}/actions/workflows/${env.WORKFLOW}/dispatches`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "user-agent": "rawjobs-feed-trigger",
      "x-github-api-version": "2022-11-28",
    },
    body: JSON.stringify({ ref: env.REF }),
  });
  if (res.status !== 204) throw new Error(`workflow_dispatch failed: HTTP ${res.status} ${(await res.text()).slice(0, 300)}`);
}

export default {
  async scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(dispatch(env));
  },
};
