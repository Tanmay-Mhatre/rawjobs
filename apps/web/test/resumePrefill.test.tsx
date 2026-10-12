// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyDraft, type Draft } from "../src/lib/setup";
import { ResumeStep } from "../src/setup/ResumeStep";

const RESUME = `Sam Rivera
Senior Product Manager, Acme Payments (2021 - now), London
Led payments and fintech products: acquiring, compliance, risk, B2B SaaS platform.
Product Manager, Beta Bank (2018 - 2021), London`;

function step(draft: Draft, draftLoaded: boolean, update: (patch: Partial<Draft>) => void) {
  return (
    <ResumeStep
      draft={draft}
      draftLoaded={draftLoaded}
      update={update}
      resumeText={RESUME}
      saveResume={async () => ({ ok: true })}
      onSkip={() => {}}
      onNext={() => {}}
      footer={(primary) => <div>{primary}</div>}
    />
  );
}

afterEach(cleanup);

describe("the wizard's resume step, with a resume saved earlier", () => {
  it("waits for the saved setup before prefilling, then prefills once", () => {
    const update = vi.fn();
    const { rerender } = render(step(emptyDraft(), false, update));
    expect(update).not.toHaveBeenCalled();
    rerender(step(emptyDraft(), true, update));
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]![0]).toHaveProperty("include");
    rerender(step(emptyDraft(), true, update));
    expect(update).toHaveBeenCalledOnce();
  });

  it("never overwrites what the loaded setup already has, whichever arrives first", () => {
    const update = vi.fn();
    const chosen: Draft = { ...emptyDraft(), include: ["designer"] };
    const { rerender } = render(step(emptyDraft(), false, update));
    rerender(step(chosen, true, update));
    expect(update).toHaveBeenCalledOnce();
    expect(update.mock.calls[0]![0]).not.toHaveProperty("include");
  });

  it("doesn't prefill once you've been past this step", () => {
    const update = vi.fn();
    render(step({ ...emptyDraft(), furthestStep: 3 }, true, update));
    expect(update).not.toHaveBeenCalled();
  });
});
