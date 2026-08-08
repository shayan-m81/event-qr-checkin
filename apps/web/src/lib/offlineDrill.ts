export type OfflineDrillConfirmation = {
  confirmedAt: string;
  deviceBrowser: string;
  buildId: string;
};

const DRILL_SESSION_KEY = "party-offline-drill-v1";

function deviceBrowserLabel(): string {
  const userAgent = navigator.userAgent;
  const browser = userAgent.includes("Firefox/") ? "Firefox"
    : userAgent.includes("Edg/") ? "Edge"
      : userAgent.includes("Chrome/") ? "Chrome"
        : userAgent.includes("Safari/") ? "Safari"
          : "Browser";
  const platform = navigator.platform || "Current device";
  return `${platform} · ${browser}`;
}

export function getOfflineDrillConfirmation(): OfflineDrillConfirmation | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(DRILL_SESSION_KEY) ?? "null") as Partial<OfflineDrillConfirmation> | null;
    return value && typeof value.confirmedAt === "string" && typeof value.deviceBrowser === "string" && typeof value.buildId === "string"
      ? value as OfflineDrillConfirmation
      : null;
  } catch { return null; }
}

export function confirmOfflineDrill(buildId: string): OfflineDrillConfirmation {
  const confirmation = { confirmedAt: new Date().toISOString(), deviceBrowser: deviceBrowserLabel(), buildId };
  sessionStorage.setItem(DRILL_SESSION_KEY, JSON.stringify(confirmation));
  return confirmation;
}
