import { Dialog } from "./Dialog";
import { JobDetail, type JobDetailProps } from "./JobDetail";

/** JobDetail as a full-height side drawer: phones (Radar) and the Pipeline. Focus is trapped and returns on close. */
export function JobDrawer(props: JobDetailProps & { onClose: () => void }) {
  return (
    <Dialog open onClose={props.onClose} label={props.job.title} placement="right">
      {/* design/components/Drawer: an L3 surface; full width (no left edge) under 720px. */}
      <div className="h-full w-full bg-overlay shadow-l3 min-[721px]:border-l min-[721px]:border-line">
        <JobDetail {...props} />
      </div>
    </Dialog>
  );
}
