import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { AuthProvider } from "./auth/AuthContext";
import type { Role } from "./auth/authorization";
import { checkInOffline, getOfflineSummary, getStoredOfflineGrant, replaceOfflineSnapshot, storeOfflineGrant } from "./lib/offlineStore";
import { renderTicketImage } from "./lib/ticketImage";

vi.mock("./lib/ticketImage", () => ({
  renderTicketImage: vi.fn().mockResolvedValue(undefined),
  ticketDownloadName: (name: string) => `${name}.png`,
}));

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromConstraints() { return new Promise(() => undefined); }
  },
}));

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <aside aria-label="test navigation">
      <output aria-label="current path">{location.pathname}</output>
      <button type="button" onClick={() => navigate("/scan")}>Test navigate to scan</button>
    </aside>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider><App /><Probe /></AuthProvider>
    </MemoryRouter>,
  );
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function authenticatedFetch(role: Role) {
  return vi.fn(async (input: string | URL | Request) => {
    const path = new URL(String(input), "https://party.test").pathname;
    if (path === "/api/auth/session") return json({ authenticated: true, role });
    if (path === "/api/auth/logout") return new Response(null, { status: 204 });
    if (path === "/api/tickets") return json({ tickets: [], refereeNames: [] });
    if (path === "/api/offline/snapshot") return json({ generatedAt: new Date().toISOString(), tickets: [] });
    if (path === "/api/readiness/status") return json({ ticketCount: 0, checkedAt: new Date().toISOString() });
    if (path === "/api/guests/totals") return json({ totalTickets: 0, checkedInCount: 0, remainingCount: 0 });
    if (path === "/api/guests") return json({
      guests: [],
      canManualCheckIn: role === "ADMIN",
      canManageTickets: role === "ADMIN",
    });
    if (path === "/api/offline/conflicts") return json({ conflicts: [] });
    return json({});
  });
}

describe("authoritative frontend authentication", () => {
  it.each(["/scan", "/admin", "/guests"])("redirects a fresh anonymous %s request to login", async (path) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json({ authenticated: false })));
    renderAt(path);
    expect(screen.getByRole("heading", { name: "Checking session…" })).toBeInTheDocument();
    expect(screen.queryByText("Ready to Scan")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Create a ticket" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Guest list" })).not.toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Ready at the door?" })).toBeInTheDocument();
    expect(screen.getByLabelText("current path")).toHaveTextContent("/login");
  });

  it("does not mount protected content while session resolution is pending", async () => {
    let resolveSession!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((resolve) => { resolveSession = resolve; })));
    renderAt("/scan");
    expect(screen.getByRole("heading", { name: "Checking session…" })).toBeInTheDocument();
    expect(screen.queryByText("Ready to Scan")).not.toBeInTheDocument();
    resolveSession(json({ authenticated: false }));
    expect(await screen.findByRole("heading", { name: "Ready at the door?" })).toBeInTheDocument();
  });

  it("establishes login state only after the session endpoint confirms the cookie", async () => {
    const user = userEvent.setup();
    let sessionCalls = 0;
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input), "https://party.test").pathname;
      if (path === "/api/auth/session") {
        sessionCalls += 1;
        return json(sessionCalls === 1 ? { authenticated: false } : { authenticated: true, role: "PRIMARY_SCANNER" });
      }
      if (path === "/api/auth/login") return json({ authenticated: true, role: "PRIMARY_SCANNER" });
      if (path === "/api/offline/snapshot") return json({ generatedAt: new Date().toISOString(), tickets: [] });
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/login");
    await user.type(await screen.findByLabelText(/access code/i), "party");
    await user.click(screen.getByRole("button", { name: /enter/i }));
    expect(await screen.findByRole("heading", { name: /check in/i })).toBeInTheDocument();
    expect(sessionCalls).toBe(2);
  });

  it("shows invalid access-code errors", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input), "https://party.test").pathname;
      return path === "/api/auth/session" ? json({ authenticated: false }) : json({ error: "invalid_access_code" }, 401);
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/login");
    await user.type(await screen.findByLabelText(/access code/i), "wrong");
    await user.click(screen.getByRole("button", { name: /enter/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("isn’t valid");
  });
});

describe("centralized route permissions", () => {
  it("allows ADMIN to navigate Admin → Scanner and Guests without redirecting", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", authenticatedFetch("ADMIN"));
    renderAt("/admin");
    expect(await screen.findByRole("heading", { name: "Create a ticket" })).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /scan/i }));
    expect(await screen.findByRole("heading", { name: "Check in" })).toBeInTheDocument();
    expect(screen.getByLabelText("current path")).toHaveTextContent("/scan");
    expect(screen.getAllByText("Admin")).not.toHaveLength(0);
    await user.click(screen.getByRole("link", { name: /guests/i }));
    expect(await screen.findByRole("heading", { name: "Guest list" })).toBeInTheDocument();
  });

  it.each(["PRIMARY_SCANNER", "SECONDARY_SCANNER"] as const)("allows %s scan/guests and rejects admin", async (role) => {
    vi.stubGlobal("fetch", authenticatedFetch(role));
    const view = renderAt("/admin");
    expect(await screen.findByRole("heading", { name: "Check in" })).toBeInTheDocument();
    expect(screen.getByLabelText("current path")).toHaveTextContent("/scan");
    expect(screen.queryByRole("link", { name: /tickets/i })).not.toBeInTheDocument();
    view.unmount();

    renderAt("/guests");
    expect(await screen.findByRole("heading", { name: "Guest list" })).toBeInTheDocument();
  });

  it("keeps emergency offline controls exclusive to PRIMARY_SCANNER", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", authenticatedFetch("PRIMARY_SCANNER"));
    const primary = renderAt("/scan");
    expect(await screen.findAllByText("Primary Scanner")).not.toHaveLength(0);
    await user.selectOptions(screen.getByLabelText(/scanner screen state/i), "CONNECTION_LOST_PRIMARY");
    expect(screen.getByRole("button", { name: /start offline scanning/i })).toBeInTheDocument();
    primary.unmount();

    vi.stubGlobal("fetch", authenticatedFetch("SECONDARY_SCANNER"));
    const secondary = renderAt("/scan");
    expect(await screen.findAllByText("Secondary Scanner")).not.toHaveLength(0);
    await user.selectOptions(screen.getByLabelText(/scanner screen state/i), "CONNECTION_LOST_SECONDARY");
    expect(screen.queryByRole("button", { name: /start offline scanning/i })).not.toBeInTheDocument();

    secondary.unmount();
    vi.stubGlobal("fetch", authenticatedFetch("ADMIN"));
    renderAt("/scan");
    expect(await screen.findAllByText("Admin")).not.toHaveLength(0);
    await user.selectOptions(screen.getByLabelText(/scanner screen state/i), "CONNECTION_LOST_SECONDARY");
    expect(screen.queryByRole("button", { name: /start offline scanning/i })).not.toBeInTheDocument();
  });

  it.each(["ADMIN", "PRIMARY_SCANNER"] as const)("allows %s to open Event Readiness", async (role) => {
    vi.stubGlobal("fetch", authenticatedFetch(role));
    renderAt("/readiness");
    expect(await screen.findByRole("heading", { name: "Event Readiness" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /event readiness/i })).toBeInTheDocument();
  });

  it("redirects SECONDARY_SCANNER away from Event Readiness", async () => {
    vi.stubGlobal("fetch", authenticatedFetch("SECONDARY_SCANNER"));
    renderAt("/readiness");
    expect(await screen.findByRole("heading", { name: "Check in" })).toBeInTheDocument();
    expect(screen.getByLabelText("current path")).toHaveTextContent("/scan");
    expect(screen.queryByRole("link", { name: /event readiness/i })).not.toBeInTheDocument();
  });
});

describe("logout", () => {
  it.each([
    ["ADMIN", "/admin"],
    ["PRIMARY_SCANNER", "/scan"],
    ["SECONDARY_SCANNER", "/scan"],
  ] as const)("logs out %s on the server and rejects later protected navigation", async (role, startPath) => {
    const user = userEvent.setup();
    const fetchMock = authenticatedFetch(role);
    vi.stubGlobal("fetch", fetchMock);
    renderAt(startPath);
    await screen.findByRole("button", { name: "Logout" });
    if (role === "PRIMARY_SCANNER") {
      await waitFor(() => expect(fetchMock.mock.calls.some(([input]) =>
        new URL(String(input), "https://party.test").pathname === "/api/offline/snapshot",
      )).toBe(true));
    }
    await replaceOfflineSnapshot([{
      ticketId: 99,
      token: "pt_logoutcleanup12345678901234567890",
      guestName: "Sensitive guest",
      ticketType: "VIP",
      voidedAt: null,
      checkedInAt: null,
    }], new Date().toISOString());
    await checkInOffline("pt_logoutcleanup12345678901234567890");
    await storeOfflineGrant("signed.offline-grant");
    await user.click(screen.getByRole("button", { name: "Logout" }));
    expect(await screen.findByRole("heading", { name: "Ready at the door?" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/logout", expect.objectContaining({ method: "POST" }));
    await expect(getOfflineSummary()).resolves.toMatchObject({ pendingCount: 1 });
    await expect(getStoredOfflineGrant()).resolves.toBeNull();
    await user.click(screen.getByRole("button", { name: "Test navigate to scan" }));
    await waitFor(() => expect(screen.getByLabelText("current path")).toHaveTextContent("/login"));
    expect(screen.queryByText("Ready to Scan")).not.toBeInTheDocument();
  });
});

describe("Admin ticket referee workflow", () => {
  const existingTickets = [
    {
      id: 1,
      token: "pt_maya0000000000000000000000000000",
      guestName: "Maya Chen",
      refereeName: "Sam Rivera",
      ticketType: "VIP",
      createdAt: "2026-08-10T10:00:00.000Z",
      voidedAt: null,
    },
    {
      id: 2,
      token: "pt_noah000000000000000000000000000",
      guestName: "Noah Williams",
      refereeName: "Alex Morgan",
      ticketType: "General admission",
      createdAt: "2026-08-10T09:00:00.000Z",
      voidedAt: null,
    },
  ];

  it("suggests previous referees while preserving free-text ticket creation", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input), "https://party.test").pathname;
      if (path === "/api/auth/session") return json({ authenticated: true, role: "ADMIN" });
      if (path === "/api/tickets" && init?.method === "POST") {
        return json({
          ticket: {
            ...existingTickets[0],
            id: 3,
            guestName: "Taylor Reed",
            refereeName: "New Referee",
          },
        }, 201);
      }
      if (path === "/api/tickets") return json({
        tickets: existingTickets,
        refereeNames: ["Alex Morgan", "Sam Rivera"],
      });
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/admin");

    const refereeInput = await screen.findByLabelText("Referee name");
    await user.click(refereeInput);
    expect(screen.getByRole("option", { name: "Alex Morgan" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Sam Rivera" })).toBeInTheDocument();

    await user.type(screen.getByLabelText("Guest name"), "Taylor Reed");
    await user.type(refereeInput, "New Referee");
    await user.click(screen.getByRole("button", { name: /generate ticket/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tickets",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          guestName: "Taylor Reed",
          refereeName: "New Referee",
          ticketType: "General admission",
        }),
      }),
    ));
    expect(await screen.findByText(/created for Taylor Reed/i)).toBeInTheDocument();
  });

  it("shows ticket details and filters the guest list by referee, type, and status", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input), "https://party.test");
      const path = url.pathname;
      if (path === "/api/auth/session") return json({ authenticated: true, role: "ADMIN" });
      if (path === "/api/guests/totals") return json({ totalTickets: 2, checkedInCount: 1, remainingCount: 1 });
      if (path === "/api/offline/conflicts") return json({ conflicts: [] });
      if (path === "/api/guests") {
        const referee = url.searchParams.get("referee")?.toLocaleLowerCase() ?? "";
        const type = url.searchParams.get("ticketType") ?? "";
        const status = url.searchParams.get("status") ?? "";
        return json({
          guests: existingTickets
            .filter((ticket) => ticket.refereeName.toLocaleLowerCase().startsWith(referee))
            .filter((ticket) => !type || ticket.ticketType === type)
            .map((ticket) => ({
              ticketId: ticket.id,
              guestName: ticket.guestName,
              refereeName: ticket.refereeName,
              ticketType: ticket.ticketType,
              createdAt: ticket.createdAt,
              status: ticket.id === 1 ? "CHECKED_IN" : "NOT_ARRIVED",
              checkedInAt: ticket.id === 1 ? "2026-08-10T11:00:00.000Z" : null,
              checkinSource: ticket.id === 1 ? "QR" : null,
            }))
            .filter((guest) => !status || guest.status === status),
          canManualCheckIn: true,
          canManageTickets: true,
        });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/guests");

    expect((await screen.findAllByText(/Sam Rivera/)).length).toBeGreaterThan(0);
    expect(await screen.findByText("1405/05/19")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /filters, all guests/i }));
    await user.type(screen.getByLabelText("Referee name"), "Alex");
    await waitFor(() => expect(screen.queryByText("Maya Chen")).not.toBeInTheDocument());
    expect(screen.getAllByText("Noah Williams").length).toBeGreaterThan(0);

    await user.clear(screen.getByLabelText("Referee name"));
    await user.selectOptions(screen.getByLabelText("Ticket type"), "VIP");
    await waitFor(() => expect(screen.queryByText("Noah Williams")).not.toBeInTheDocument());
    expect(screen.getAllByText("Maya Chen").length).toBeGreaterThan(0);
    await user.selectOptions(screen.getByLabelText("Ticket type"), "GENERAL");
    await waitFor(() => expect(screen.queryByText("Maya Chen")).not.toBeInTheDocument());
    expect(screen.getAllByText("Noah Williams").length).toBeGreaterThan(0);

    await user.selectOptions(screen.getByLabelText("Ticket type"), "ALL");
    await user.selectOptions(screen.getByLabelText("Guest status"), "CHECKED_IN");
    await waitFor(() => expect(screen.queryByText("Noah Williams")).not.toBeInTheDocument());
    expect(screen.getAllByText("Maya Chen").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /filters, 1 active/i })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Guest status"), "NOT_ARRIVED");
    await waitFor(() => expect(screen.queryByText("Maya Chen")).not.toBeInTheDocument());
    expect(screen.getAllByText("Noah Williams").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(screen.getAllByText("Maya Chen").length).toBeGreaterThan(0));
    expect(screen.getByRole("button", { name: /filters, all guests/i })).toBeInTheDocument();
  });
});

describe("ticket cancellation UI", () => {
  it("requires confirmation and sends the ADMIN cancel request", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input), "https://party.test").pathname;
      if (path === "/api/auth/session") return json({ authenticated: true, role: "ADMIN" });
      if (path === "/api/guests/totals") return json({ totalTickets: 1, checkedInCount: 0, remainingCount: 1 });
      if (path === "/api/offline/conflicts") return json({ conflicts: [] });
      if (path === "/api/guests") return json({
        guests: [{
          ticketId: 17,
          guestName: "Casey Cancel",
          ticketType: "VIP",
          status: "NOT_ARRIVED",
          checkedInAt: null,
          checkinSource: null,
        }],
        canManualCheckIn: true,
        canManageTickets: true,
      });
      if (path === "/api/tickets/17/cancel" && init?.method === "POST") {
        return json({ ticket: { id: 17, voidedAt: "2026-08-08T20:00:00.000Z" } });
      }
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/guests");

    await user.click(await screen.findByRole("button", { name: "Cancel Ticket" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent('Cancel ticket for "Casey Cancel"?');
    expect(dialog).toHaveTextContent("Their existing QR code will no longer be accepted.");
    await user.click(within(dialog).getByRole("button", { name: "Cancel Ticket" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tickets/17/cancel",
      expect.objectContaining({ method: "POST" }),
    ));
  });
});

describe("ticket correction UI", () => {
  it("lets ADMIN correct ticket details and offers updated artwork without replacing the QR", async () => {
    const user = userEvent.setup();
    const originalTicket = {
      id: 17,
      token: "pt_original00000000000000000000000",
      guestName: "Mya Chen",
      refereeName: "Sam Rvera",
      ticketType: "General admission",
      createdAt: "2026-08-10T10:00:00.000Z",
      voidedAt: null,
    };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input), "https://party.test").pathname;
      if (path === "/api/auth/session") return json({ authenticated: true, role: "ADMIN" });
      if (path === "/api/guests/totals") return json({ totalTickets: 1, checkedInCount: 0, remainingCount: 1 });
      if (path === "/api/offline/conflicts") return json({ conflicts: [] });
      if (path === "/api/tickets/17" && init?.method === "PATCH") {
        return json({
          ticket: {
            ...originalTicket,
            guestName: "Maya Chen",
            refereeName: "Sam Rivera",
            ticketType: "VIP",
          },
        });
      }
      if (path === "/api/guests") return json({
        guests: [{
          ticketId: originalTicket.id,
          guestName: originalTicket.guestName,
          refereeName: originalTicket.refereeName,
          ticketType: originalTicket.ticketType,
          createdAt: originalTicket.createdAt,
          status: "NOT_ARRIVED",
          checkedInAt: null,
          checkinSource: null,
        }],
        canManualCheckIn: true,
        canManageTickets: true,
      });
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/guests");

    await user.click(await screen.findByRole("button", { name: "Edit Ticket" }));
    const dialog = screen.getByRole("dialog", { name: /edit ticket for/i });
    const guestInput = within(dialog).getByLabelText("Guest name");
    const refereeInput = within(dialog).getByLabelText("Referee name");
    await user.clear(guestInput);
    await user.type(guestInput, "Maya Chen");
    await user.clear(refereeInput);
    await user.type(refereeInput, "Sam Rivera");
    await user.selectOptions(within(dialog).getByLabelText("Ticket type"), "VIP");
    await user.click(within(dialog).getByRole("button", { name: "Save Changes" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tickets/17",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ guestName: "Maya Chen", refereeName: "Sam Rivera", ticketType: "VIP" }),
      }),
    ));
    expect(await screen.findByRole("heading", { name: "Download current ticket" })).toBeInTheDocument();
    expect(screen.getByText(/QR code is unchanged/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /download ticket png/i })).toBeEnabled();
  });

  it("regenerates current artwork from the authoritative ticket record after a reload", async () => {
    const user = userEvent.setup();
    const currentTicket = {
      id: 21,
      token: "pt_preserved0000000000000000000000",
      guestName: "Maya Chen",
      refereeName: "Sam Rivera",
      ticketType: "VIP",
      createdAt: "2026-08-10T10:00:00.000Z",
      voidedAt: null,
    };
    vi.mocked(renderTicketImage).mockClear();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input), "https://party.test").pathname;
      if (path === "/api/auth/session") return json({ authenticated: true, role: "ADMIN" });
      if (path === "/api/guests/totals") return json({ totalTickets: 1, checkedInCount: 0, remainingCount: 1 });
      if (path === "/api/offline/conflicts") return json({ conflicts: [] });
      if (path === "/api/tickets/21") return json({ ticket: currentTicket });
      if (path === "/api/guests") return json({
        guests: [{
          ticketId: currentTicket.id,
          guestName: currentTicket.guestName,
          refereeName: currentTicket.refereeName,
          ticketType: currentTicket.ticketType,
          createdAt: currentTicket.createdAt,
          status: "NOT_ARRIVED",
          checkedInAt: null,
          checkinSource: null,
        }],
        canManualCheckIn: true,
        canManageTickets: true,
      });
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/guests");

    await user.click(await screen.findByRole("button", { name: "Regenerate Ticket" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/tickets/21",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    expect(await screen.findByRole("heading", { name: "Download current ticket" })).toBeInTheDocument();
    await waitFor(() => expect(renderTicketImage).toHaveBeenCalledWith(
      expect.any(HTMLCanvasElement),
      expect.objectContaining({ id: 21, token: currentTicket.token, guestName: "Maya Chen" }),
    ));
    expect(screen.getByRole("button", { name: /download ticket png/i })).toBeEnabled();
  });

  it("locks ticket type after check-in while allowing name corrections", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const path = new URL(String(input), "https://party.test").pathname;
      if (path === "/api/auth/session") return json({ authenticated: true, role: "ADMIN" });
      if (path === "/api/guests/totals") return json({ totalTickets: 1, checkedInCount: 1, remainingCount: 0 });
      if (path === "/api/offline/conflicts") return json({ conflicts: [] });
      if (path === "/api/guests") return json({
        guests: [{
          ticketId: 18,
          guestName: "Checked Guest",
          refereeName: "Sam Rivera",
          ticketType: "VIP",
          createdAt: "2026-08-10T10:00:00.000Z",
          status: "CHECKED_IN",
          checkedInAt: "2026-08-10T11:00:00.000Z",
          checkinSource: "QR",
        }],
        canManualCheckIn: true,
        canManageTickets: true,
      });
      return json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    renderAt("/guests");

    await user.click(await screen.findByRole("button", { name: "Edit Ticket" }));
    const dialog = screen.getByRole("dialog", { name: /edit ticket for/i });
    expect(within(dialog).getByLabelText("Ticket type")).toBeDisabled();
    expect(within(dialog).getByText(/type is locked after check-in/i)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Guest name")).toBeEnabled();
  });
});
