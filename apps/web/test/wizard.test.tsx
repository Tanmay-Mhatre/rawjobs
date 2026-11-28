// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, STEP, type Draft } from "../src/lib/setup";

vi.mock("../src/lib/data", async (orig) => ({ ...(await orig<typeof import("../src/lib/data")>()), canRunLocally: true }));
const { Wizard } = await import("../src/setup/Wizard");

afterEach(cleanup);

/** The Wizard with its step and draft kept in state, as the app keeps them. */
function Harness({
  start = STEP.welcome,
  existing = false,
  configErrors,
  onExit = () => {},
  onStart = () => {},
}: {
  start?: number;
  existing?: boolean;
  configErrors?: string;
  onExit?: () => void;
  onStart?: () => void;
}) {
  const [step, setStep] = useState(start);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  return (
    <Wizard
      step={step}
      goStep={setStep}
      draft={draft}
      draftLoaded
      update={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      existing={existing}
      configErrors={configErrors}
      startScan={async () => {}}
      onSaved={async () => {}}
      onFinish={() => {}}
      onExit={onExit}
      onStart={() => {
        onStart();
        setStep(STEP.resume);
      }}
      onStartOver={() => {}}
      progress={{ started: false, nextStep: STEP.resume }}
      resumeText=""
      saveResume={async () => ({ ok: true })}
      removeResume={async () => ({ ok: true })}
    />
  );
}

const heading = () => screen.getByRole("heading", { level: 1 }).textContent;

describe("the setup wizard", () => {
  it("welcomes a first run, and its start button opens the résumé step", () => {
    const onStart = vi.fn();
    render(<Harness onStart={onStart} />);
    expect(heading()).toBe("Let's set up your job radar");
    fireEvent.click(screen.getAllByRole("button").find((b) => /set up|start|begin/i.test(b.textContent ?? ""))!);
    expect(onStart).toHaveBeenCalledOnce();
    expect(heading()).toBe("Start with your resume");
    expect(document.title).toBe("RawJobs · Setup · Resume");
  });

  it("won't go past roles without one, and Back returns to the résumé step", () => {
    render(<Harness start={STEP.roles} />);
    expect(heading()).toBe("What roles are you looking for?");
    const next = () => screen.getAllByRole("button").find((b) => /Continue|Skip for now/.test(b.textContent ?? ""))!;
    expect((next() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(heading()).toBe("Start with your resume");
  });

  it("goes straight to Review for someone with a working setup", async () => {
    render(<Harness existing />);
    expect(await screen.findByRole("heading", { level: 1, name: "Review and save" })).toBeTruthy();
  });

  it("says when saved settings couldn't be read, instead of skipping the Welcome", () => {
    render(<Harness existing configErrors="titles.include: expected an array" />);
    expect(heading()).toBe("Fix your setup");
    expect(screen.getByText("Some saved settings couldn't be read. Everything readable is loaded.")).toBeTruthy();
    expect(screen.getByText("titles.include: expected an array")).toBeTruthy();
  });
});
