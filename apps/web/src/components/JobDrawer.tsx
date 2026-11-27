import { Dialog } from "./Dialog";
import { ErrorBoundary } from "./ErrorBoundary";
import { JobDetail, type JobDetailProps } from "./JobDetail";
import { Button } from "./primitives";

/** JobDetail as a full-height side drawer: phones (Radar) and the Pipeline. Focus is trapped and returns on close. */
export function JobDrawer(props: JobDetailProps & { onClose: () => void }) {
  return (
    <Dialog open onClose={props.onClose} label={props.job.title} placement="right">
      {/* design/components/Drawer: an L3 surface; full width (no left edge) under 720px. */}
      <div className="h-full w-full bg-overlay shadow-l3 min-[721px]:border-l min-[721px]:border-line">
        {/* A job that fails to show keeps the drawer frame, so Esc still works, and the card has its own Close
          (JobDetail's close button broke with it; a phone has no Esc). */}
        <ErrorBoundary key={props.job.id} where="this job" className="max-[720px]:mx-4" actions={<Button onClick={props.onClose}>Close</Button>}>
          <JobDetail {...props} />
        </ErrorBoundary>
      </div>
    </Dialog>
  );
}
