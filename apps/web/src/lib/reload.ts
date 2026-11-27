let byApp = false;

/**
 * Reload the page for the app's own reasons (an update, RawJobs back after a restart). Unsaved
 * Settings edits are already kept in this browser, so the "Leave site?" prompt is skipped.
 */
export function reloadPage(): void {
  byApp = true;
  location.reload();
}

/** The app itself is reloading the page (see reloadPage): no leave prompt. */
export const reloadingByApp = (): boolean => byApp;
