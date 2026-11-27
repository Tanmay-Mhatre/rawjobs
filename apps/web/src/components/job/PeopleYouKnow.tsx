import { Users } from "lucide-react";
import type { RefObject } from "react";
import { isAgencyPosting } from "../../lib/agency";
import type { Job } from "../../lib/data";
import { useNetwork, usePeopleAt } from "../../lib/network";
import { companyName } from "../../lib/format";

/**
 * "3 you know" under the title once your LinkedIn connections are imported: jumps to the people section.
 * Same request as that section (the network store keeps one per company).
 */
export function PeopleYouKnow({ job, scrollRef }: { job: Job; scrollRef: RefObject<HTMLDivElement | null> }) {
  const network = useNetwork();
  const connected = network?.state === "ready" && !!network.value.status.connected;
  const agency = isAgencyPosting(job);
  const people = usePeopleAt(job.company, connected && !agency);
  const n = people?.state === "ready" ? people.value.people.length : 0;
  if (!n) return null;
  // A match on the start of the name only ("Acme" for "Acme Bank"): not sure they work here.
  const label = people?.state === "ready" && people.value.how === "prefix" ? `${n} you may know` : `${n} you know`;
  const jump = () => {
    const heading = scrollRef.current?.querySelector(`#talk-${CSS.escape(job.id)}`);
    heading?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <button type="button" onClick={jump} className="rj-pill justify-self-start text-ink hover:bg-hover" title={`People you know at ${companyName(job.company)}, from your LinkedIn connections`}>
      <Users className="size-4 shrink-0 text-muted" aria-hidden />
      {label}
    </button>
  );
}
