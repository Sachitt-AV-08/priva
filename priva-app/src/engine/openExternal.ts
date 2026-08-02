export function openExternal(value: string | undefined) {
  if (!value) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return;
    if (window.priva?.shell?.openExternal) {
      void window.priva.shell.openExternal(url.toString());
    } else {
      window.open(url.toString(), "_blank", "noopener,noreferrer");
    }
  } catch {
    // Ignore malformed product and checkout URLs.
  }
}
