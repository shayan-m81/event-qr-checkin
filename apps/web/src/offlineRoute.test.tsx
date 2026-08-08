import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import { authorizeOfflinePrimary } from "./auth/offlineBootstrap";
import { checkInOffline, clearOfflineDatabase, replaceOfflineSnapshot, setOfflineModeEnabled } from "./lib/offlineStore";

vi.mock("./auth/offlineBootstrap", () => ({ authorizeOfflinePrimary: vi.fn() }));
vi.mock("@zxing/browser", () => ({ BrowserQRCodeReader: class { decodeFromConstraints() { return new Promise(() => undefined); } } }));

function renderPath(path = "/scan") {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><App /></AuthProvider></MemoryRouter>);
}

const token = "pt_reload1234567890123456789012345678";

beforeEach(async () => {
  await clearOfflineDatabase();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  });
  vi.mocked(authorizeOfflinePrimary).mockResolvedValue({
    authorized: true,
    grant: { v: 1, type: "offline_scanner_grant", role: "PRIMARY_SCANNER", scope: "party-check-in", iat: 1, exp: 9999999999, jti: "route-grant-id-12345" },
  });
});

describe("offline scanner route bootstrap", () => {
  it("reopens after an offline reload and retains pending state", async () => {
    await replaceOfflineSnapshot([{ ticketId: 1, token, guestName: "Reload Guest", ticketType: "VIP", voidedAt: null, checkedInAt: null }], new Date().toISOString());
    await setOfflineModeEnabled(true);
    await checkInOffline(token);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

    const first = renderPath();
    expect(await screen.findByText("Primary Scanner · Offline authorization")).toBeInTheDocument();
    expect(await screen.findByText("Emergency Offline")).toBeInTheDocument();
    expect(first.container.querySelector(".offline-queue")).toHaveTextContent("1 pending sync");
    first.unmount();

    const second = renderPath();
    expect(await screen.findByText("Primary Scanner · Offline authorization")).toBeInTheDocument();
    await waitFor(() => expect(second.container.querySelector(".offline-queue")).toHaveTextContent("1 pending sync"));
    await expect(checkInOffline(token)).resolves.toMatchObject({ state: "ALREADY_USED" });
  });

  it("fails closed when offline preparation is unavailable", async () => {
    vi.mocked(authorizeOfflinePrimary).mockResolvedValue({ authorized: false, reason: "No offline grant prepared" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderPath();
    expect(await screen.findByRole("heading", { name: "Offline Access Unavailable" })).toBeInTheDocument();
    expect(screen.queryByText("Ready to Scan")).not.toBeInTheDocument();
  });

  it("uses the prepared grant when the session API returns an outage response", async () => {
    await replaceOfflineSnapshot([], new Date().toISOString());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "unavailable" }), { status: 503 })));
    renderPath();
    expect(await screen.findByText("Primary Scanner · Offline authorization")).toBeInTheDocument();
  });

  it("requires a real server session after reconnection", async () => {
    await replaceOfflineSnapshot([], new Date().toISOString());
    await setOfflineModeEnabled(true);
    let online = false;
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request) => {
      if (!online) throw new TypeError("offline");
      const path = new URL(String(input), "https://party.test").pathname;
      if (path === "/api/auth/session") return new Response(JSON.stringify({ authenticated: true, role: "PRIMARY_SCANNER" }), { headers: { "Content-Type": "application/json" } });
      if (path === "/api/offline/snapshot") return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), tickets: [] }), { headers: { "Content-Type": "application/json" } });
      return new Response("{}", { headers: { "Content-Type": "application/json" } });
    }));
    renderPath();
    expect(await screen.findByText("Primary Scanner · Offline authorization")).toBeInTheDocument();
    online = true;
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(screen.queryByText("Primary Scanner · Offline authorization")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Logout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /guest search/i })).toBeInTheDocument();
  });

  it("returns to login when reconnection reports no valid server session", async () => {
    await replaceOfflineSnapshot([], new Date().toISOString());
    let online = false;
    vi.stubGlobal("fetch", vi.fn(async () => {
      if (!online) throw new TypeError("offline");
      return new Response(JSON.stringify({ authenticated: false }), { headers: { "Content-Type": "application/json" } });
    }));
    renderPath();
    expect(await screen.findByText("Primary Scanner · Offline authorization")).toBeInTheDocument();
    online = true;
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByRole("heading", { name: "Ready at the door?" })).toBeInTheDocument();
  });

  it("cannot use the offline capability to open Admin", async () => {
    await replaceOfflineSnapshot([], new Date().toISOString());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderPath("/admin");
    expect(await screen.findByRole("heading", { name: "Check in" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create a ticket" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /tickets/i })).not.toBeInTheDocument();
  });
});
