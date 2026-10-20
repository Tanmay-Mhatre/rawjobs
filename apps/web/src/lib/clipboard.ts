/**
 * Copy text, falling back to the legacy copy command when the Clipboard API is blocked
 * (permissions, embedded browsers, plain-http hosts). Returns false if both fail, so the
 * caller can show the text selected for a manual Ctrl/Cmd+C. `win` is the window the click happened
 * in, such as the See people card's Picture-in-Picture window, whose own clipboard and document are used.
 */
export async function copyText(text: string, win: Window = window): Promise<boolean> {
  const doc = win.document;
  try {
    await win.navigator.clipboard.writeText(text);
    return true;
  } catch {
    // fall through
  }
  try {
    const ta = doc.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    doc.body.appendChild(ta);
    ta.select();
    const ok = doc.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
