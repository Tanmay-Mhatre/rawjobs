import { RefreshCw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Card, cx } from "./ui";

type Props = {
  children: ReactNode;
  /** What broke, in the message: "this page", "RawJobs". */
  where?: string;
  /** More buttons next to Try again, such as Close where the broken part had the only close button. */
  actions?: ReactNode;
  /** Extra classes for the card. */
  className?: string;
};
type State = { error: Error | null };

/**
 * A part of the app that throws while drawing shows this card instead of a blank window: what
 * happened, how to recover (Try again redraws it, Reload starts the page afresh), and the error tucked
 * away for a bug report. Your jobs and tracking are saved on disk, so nothing is lost.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("RawJobs: a part of the page stopped working", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Card className={cx("mx-auto my-6 max-w-lg p-8 text-center", this.props.className)}>
        <div role="alert">
          <h2 className="type-subheading font-semibold">Something went wrong on {this.props.where ?? "this page"}</h2>
          <p className="mt-1 type-small text-muted">Your jobs and tracking are saved. Try again, or reload RawJobs if it keeps happening.</p>
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button variant="primary" onClick={() => this.setState({ error: null })}>
            <RefreshCw className="size-4" /> Try again
          </Button>
          <Button onClick={() => location.reload()}>Reload RawJobs</Button>
          {this.props.actions}
        </div>
        <details className="mt-4 text-left type-meta text-muted">
          <summary className="cursor-pointer">Technical details</summary>
          <p className="mt-1 break-words font-mono">{error.stack ?? error.message}</p>
        </details>
      </Card>
    );
  }
}
