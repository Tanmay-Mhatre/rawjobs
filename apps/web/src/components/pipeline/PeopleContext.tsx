import { createContext, type ReactNode, useContext } from "react";
import type { Contact, UserState } from "../../lib/userState";

/**
 * Everyone you track, for the job detail's People tab: "Add someone you already know" picks from
 * your other jobs, and an edit goes to every job the person is on (useUserState().updateContact).
 * Without it (tests, a bare detail) the tab still works on this job alone.
 */
export type PeopleApi = { state: UserState; updateContact: (c: Contact) => void };

const Ctx = createContext<PeopleApi | null>(null);

export function PeopleProvider({ value, children }: { value: PeopleApi; children: ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePeople = () => useContext(Ctx);
