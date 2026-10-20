/** Your LinkedIn connections, read from LinkedIn's data export. Kept in `profile/network.json`. */

export type NetworkConnection = {
  /** Stable across re-imports: "u:" + the /in/<slug> from the profile URL; else "n:" + a hash of first|last|company. */
  id: string;
  first: string;
  last: string;
  /** https://www.linkedin.com/in/<slug> only, else omitted. */
  url?: string;
  /** As LinkedIn wrote it. */
  company?: string;
  position?: string;
  /** YYYY-MM-DD from "Connected On". */
  connectedOn?: string;
};

export type NetworkPosition = {
  company: string;
  title?: string;
  /** YYYY-MM */
  from?: string;
  /** YYYY-MM; missing means current. */
  to?: string;
};

export type NetworkSchool = {
  name: string;
  /** YYYY */
  from?: string;
  /** YYYY */
  to?: string;
  degree?: string;
};

export type NetworkFile = {
  app: "rawjobs";
  kind: "network";
  version: 1;
  /** ISO */
  importedAt: string;
  source: "downloads" | "file";
  /** The ZIP's name, never its path. */
  fileName?: string;
  connections: NetworkConnection[];
  positions: NetworkPosition[];
  education: NetworkSchool[];
  /** Connection ids you marked as a close contact; kept across re-imports by id. */
  friends: string[];
};

export type WatchState = { since: string; until: string; folder: string; lastError?: string; found?: string };

/** What the browser and the API exchange. Never the Email column. */
export type NetworkStatus =
  | { connected: false; watch: WatchState | null }
  | {
      connected: true;
      importedAt: string;
      fileName?: string;
      source: "downloads" | "file";
      counts: { connections: number; positions: number; education: number; companies: number };
      /** Days since import; the browser words it. */
      ageDays: number;
      watch: WatchState | null;
    };

/** One person for the panel: a connection row plus whether you tagged them. */
export type NetworkPerson = NetworkConnection & { friend: boolean };
