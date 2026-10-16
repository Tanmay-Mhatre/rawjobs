import { Kbd } from "./ui";

/** Every single-key shortcut the dashboard handles, and only those (design/README.md, Interaction). */
export function shortcutRows(canScan: boolean): [string[], string][] {
  return [
    [["J", "K"], "Next / previous job"],
    [["Enter"], "Open job"],
    [["S"], "Save"],
    [["A"], "Mark as applied"],
    [["X"], "Not interested"],
    [["C"], "Copy description"],
    [["F"], "Expand job to full window"],
    ...(canScan ? [[["R"], "Scan now"] as [string[], string]] : []),
    [["/"], "Search (the Radar, or Settings)"],
    [["1", "3"], "Radar quick filters: My companies, New, Strong (on or off)"],
    [["1", "4"], "Switch section, outside the Radar"],
    [["G", "R"], "Go to Radar"],
    [["G", "P"], "Go to Pipeline"],
    [["G", "C"], "Go to Companies"],
    [["G", "S"], "Go to Settings"],
    [["[", "]"], "Move a pipeline card back / forward"],
    [["?"], "Show these shortcuts"],
    [["Esc"], "Close"],
  ];
}

/** The shortcuts as label and keys, one per line: in the "?" window and on Settings › Keyboard. */
export function ShortcutList({ canScan, className }: { canScan: boolean; className?: string }) {
  return (
    <ul className={className ?? "space-y-2 type-small"}>
      {shortcutRows(canScan).map(([keys, label]) => (
        <li key={label} className="flex items-center justify-between gap-3">
          <span className="text-muted">{label}</span>
          <span className="flex shrink-0 items-center gap-1">
            {keys.map((k, i) => (
              <span key={k} className="flex items-center gap-1">
                {/* Two digits are a range ("1–6"), "G" starts a sequence ("G then R"), other keys a pair ("J / K"). */}
                {i > 0 && <span className="type-meta text-muted">{/^\d$/.test(k) ? "–" : keys[0] === "G" ? "then" : "/"}</span>}
                <Kbd>{k}</Kbd>
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
