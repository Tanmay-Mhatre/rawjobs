import { X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Dialog } from "../Dialog";
import { Button, Card, IconButton } from "../ui";

/**
 * "Are you sure?" for something that can't be undone (Start setup over, Delete connections). Cancel
 * has focus first. `onConfirm` returns an error to show, or null to close.
 */
export function ConfirmDialog({
  id,
  open,
  onClose,
  title,
  children,
  confirmLabel,
  workingLabel,
  onConfirm,
}: {
  id: string;
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  workingLabel: string;
  onConfirm: () => Promise<string | null>;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    if (working) return;
    setError(null);
    onClose();
  };
  const confirm = async () => {
    setWorking(true);
    setError(null);
    const err = await onConfirm();
    setWorking(false);
    if (err) setError(err);
    else onClose();
  };
  return (
    <Dialog open={open} onClose={close} labelledBy={`${id}-title`} initialFocus="[data-autofocus]">
      <Card className="p-5 shadow-l3 sm:p-6">
        <div className="flex items-start gap-3">
          <h2 id={`${id}-title`} className="min-w-0 flex-1 type-subheading font-semibold">
            {title}
          </h2>
          <IconButton label="Close" className="-mr-2 -mt-1" onClick={close} disabled={working}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="mt-1 space-y-2 type-small text-muted">{children}</div>
        {error && (
          <p role="alert" className="mt-2 type-small text-danger-text">
            {error}
          </p>
        )}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close} disabled={working} data-autofocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void confirm()} disabled={working}>
            {working ? workingLabel : confirmLabel}
          </Button>
        </div>
      </Card>
    </Dialog>
  );
}
