import { BASE_CONCEPTS } from "./catalog/concepts";
import { topicMentions } from "./concepts";
import { resumeBody } from "./resume-parse";

/**
 * Topics read from your résumé, for a profile that has none of its own: the topics RawJobs knows
 * (catalog/concepts.ts) that the résumé names, or names through a word that proves them ("PSP" for
 * payments). Only strong evidence counts: named at least twice. More mentions, more weight (2 to 4),
 * at most 12 topics. Scans use them automatically; topics you set yourself always replace them.
 */
export const RESUME_TOPICS = { minMentions: 2, max: 12 } as const;

export function resumeTopics(text: string | null | undefined): Record<string, number> {
  if (!text?.trim()) return {};
  const body = resumeBody(text);
  const found = Object.keys(BASE_CONCEPTS)
    .map((topic) => ({ topic, n: topicMentions(body, topic, 8).n }))
    .filter((t) => t.n >= RESUME_TOPICS.minMentions)
    .sort((a, b) => b.n - a.n || a.topic.localeCompare(b.topic))
    .slice(0, RESUME_TOPICS.max);
  return Object.fromEntries(found.map(({ topic, n }) => [topic, n >= 5 ? 4 : n >= 3 ? 3 : 2]));
}
