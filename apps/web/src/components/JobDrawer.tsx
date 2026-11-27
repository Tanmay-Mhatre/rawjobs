import { Dialog } from "./Dialog";
import { ErrorBoundary } from "./ErrorBoundary";
import { JobDetail, type JobDetailProps } from "./JobDetail";

/** JobDetail as a full-height side drawer: phones (Radar) and the Pipeline. Focus is trapped and returns on close. */
export function JobDrawer(props: JobDetailProps & { onClose: () => void }) {
  return (
    <Dialog open onClose={props.onClose} label={props.job.title} placement="right">
      {/* design/components/Drawer: an L3 surface; full width (no left edge) under 720px. */}
      <div className="h-full w-full bg-overlay shadow-l3 min-[721px]:border-l min-[721px]:border-line">
        {/* A job that fails to show keeps the drawer frame, so Esc and close still work. */}
        <ErrorBoundary key={props.job.id} where="this job">
          <JobDetail {...props} />
        </ErrorBoundary>
      </div>
    </Dialog>
  );
}
