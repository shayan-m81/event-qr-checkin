import { useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { formatJalaliDate, formatJalaliDateTime } from "../lib/jalaliDate";
import { requestWithTimeout } from "../lib/request";

type GuestStatus = "CHECKED_IN" | "NOT_ARRIVED" | "CANCELLED";

type Guest = {
  ticketId: number;
  guestName: string;
  refereeName: string;
  ticketType: string;
  createdAt: string;
  status: GuestStatus;
  checkedInAt: string | null;
  checkinSource: string | null;
};

type Totals = {
  totalTickets: number;
  checkedInCount: number;
  remainingCount: number;
};

type Feedback = {
  tone: "success" | "danger" | "warning";
  message: string;
} | null;

type TicketTypeFilter = "ALL" | "VIP" | "GENERAL";

type OfflineConflict = {
  client_operation_id: string;
  local_checked_in_at: string;
  existing_checked_in_at: string;
  detected_at: string;
  ticket_id: number;
  guest_name: string;
  ticket_type: string;
};

const emptyTotals: Totals = { totalTickets: 0, checkedInCount: 0, remainingCount: 0 };

function initials(name: string): string {
  return name.split(" ").filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function checkinDateTime(value: string | null): string {
  return value ? formatJalaliDateTime(value) : "";
}

function statusLabel(guest: Guest): string {
  if (guest.status === "CANCELLED") return "CANCELLED";
  if (guest.status === "CHECKED_IN") return "CHECKED IN";
  return "NOT CHECKED IN";
}

export function GuestsPage() {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [totals, setTotals] = useState<Totals>(emptyTotals);
  const [query, setQuery] = useState("");
  const [refereeFilter, setRefereeFilter] = useState("");
  const [ticketTypeFilter, setTicketTypeFilter] = useState<TicketTypeFilter>("ALL");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [canManualCheckIn, setCanManualCheckIn] = useState(false);
  const [canManageTickets, setCanManageTickets] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [manualTicketId, setManualTicketId] = useState<number | null>(null);
  const [managingTicketId, setManagingTicketId] = useState<number | null>(null);
  const [cancelCandidate, setCancelCandidate] = useState<Guest | null>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [loadError, setLoadError] = useState("");
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [offlineConflicts, setOfflineConflicts] = useState<OfflineConflict[]>([]);
  const manualCheckinLock = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsLoading(true);
      setLoadError("");
      try {
        const params = new URLSearchParams();
        if (query.trim()) params.set("query", query.trim());
        if (refereeFilter.trim()) params.set("referee", refereeFilter.trim());
        if (ticketTypeFilter === "VIP") params.set("ticketType", "VIP");
        if (ticketTypeFilter === "GENERAL") params.set("ticketType", "General admission");
        const response = await requestWithTimeout(`/api/guests?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Guest list request failed");
        const body = await response.json() as {
          guests: Guest[];
          canManualCheckIn: boolean;
          canManageTickets: boolean;
        };
        setGuests(body.guests);
        setCanManualCheckIn(body.canManualCheckIn);
        setCanManageTickets(body.canManageTickets);
      } catch (error) {
        if (!controller.signal.aborted) setLoadError("Couldn’t load the guest list. Check your connection and retry.");
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, 250);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [query, refereeFilter, ticketTypeFilter, refreshVersion]);

  useEffect(() => {
    const controller = new AbortController();
    void requestWithTimeout("/api/guests/totals", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Totals request failed");
        return response.json() as Promise<Totals>;
      })
      .then(setTotals)
      .catch(() => undefined);
    return () => controller.abort();
  }, [refreshVersion]);

  useEffect(() => {
    if (!canManualCheckIn) return;
    const controller = new AbortController();
    void requestWithTimeout("/api/offline/conflicts", { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Conflict request failed")))
      .then((body: { conflicts?: OfflineConflict[] }) => setOfflineConflicts(Array.isArray(body.conflicts) ? body.conflicts : []))
      .catch(() => undefined);
    return () => controller.abort();
  }, [canManualCheckIn, refreshVersion]);

  useEffect(() => {
    if (!guests.some((guest) => guest.ticketId === selectedId)) {
      setSelectedId(guests[0]?.ticketId ?? null);
    }
  }, [guests, selectedId]);

  const selectedGuest = useMemo(
    () => guests.find((guest) => guest.ticketId === selectedId) ?? null,
    [guests, selectedId],
  );

  async function manualCheckIn(guest: Guest) {
    if (!canManualCheckIn || manualCheckinLock.current) return;
    manualCheckinLock.current = true;
    setManualTicketId(guest.ticketId);
    setFeedback(null);
    try {
      const response = await requestWithTimeout(`/api/guests/${guest.ticketId}/checkin`, { method: "POST" });
      if (!response.ok) throw new Error("Manual check-in request failed");
      const result = await response.json() as {
        state: "VALID" | "ALREADY_USED" | "INVALID" | "VOIDED";
        checkedInAt?: string;
      };
      if (result.state === "VALID") {
        setFeedback({ tone: "success", message: `${guest.guestName} checked in successfully.` });
      } else if (result.state === "ALREADY_USED") {
        setFeedback({
          tone: "danger",
          message: `${guest.guestName} was already checked in${result.checkedInAt ? ` at ${checkinDateTime(result.checkedInAt)}` : ""}.`,
        });
      } else if (result.state === "VOIDED") {
        setFeedback({ tone: "danger", message: `TICKET CANCELLED — DO NOT ADMIT. ${guest.guestName} was not checked in.` });
      } else {
        setFeedback({ tone: "danger", message: "This ticket no longer exists." });
      }
      setRefreshVersion((version) => version + 1);
    } catch {
      setFeedback({ tone: "danger", message: "Manual check-in failed. No guest was admitted." });
    } finally {
      manualCheckinLock.current = false;
      setManualTicketId(null);
    }
  }

  async function manageTicket(guest: Guest, action: "cancel" | "restore") {
    if (!canManageTickets || managingTicketId !== null) return;
    setManagingTicketId(guest.ticketId);
    setCancelCandidate(null);
    setFeedback(null);
    try {
      const response = await requestWithTimeout(`/api/tickets/${guest.ticketId}/${action}`, { method: "POST" });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (response.status === 409 && body.error === "ticket_already_checked_in") {
        setFeedback({
          tone: "danger",
          message: `${guest.guestName} cannot be restored because this ticket has already checked in.`,
        });
        return;
      }
      if (!response.ok) throw new Error("Ticket update failed");
      setFeedback({
        tone: "success",
        message: action === "cancel"
          ? `${guest.guestName}’s ticket is cancelled. Refresh the Primary Scanner offline cache before using offline mode.`
          : `${guest.guestName}’s original ticket is restored. Refresh the Primary Scanner offline cache before using offline mode.`,
      });
      setRefreshVersion((version) => version + 1);
    } catch {
      setFeedback({ tone: "danger", message: `Couldn’t ${action} this ticket. No ticket state was changed.` });
    } finally {
      setManagingTicketId(null);
    }
  }

  return (
    <AppShell eyebrow="Tonight’s party" title="Guest list" action={<span className="count-badge">{totals.totalTickets}</span>}>
      <div className="guest-totals" aria-label="Guest totals">
        <div><strong>{totals.totalTickets}</strong><span>Total tickets</span></div>
        <div><strong className="green-text">{totals.checkedInCount}</strong><span>Checked in</span></div>
        <div><strong>{totals.remainingCount}</strong><span>Remaining</span></div>
      </div>

      {offlineConflicts.length > 0 && (
        <section className="offline-conflicts" aria-labelledby="offline-conflicts-title">
          <p className="eyebrow">Needs review</p>
          <h2 id="offline-conflicts-title">Offline synchronization conflicts</h2>
          {offlineConflicts.map((conflict) => (
            <div key={conflict.client_operation_id}>
              <strong>{conflict.guest_name}</strong>
              <span>Offline at {checkinDateTime(conflict.local_checked_in_at)} · server check-in at {checkinDateTime(conflict.existing_checked_in_at)}</span>
            </div>
          ))}
        </section>
      )}

      <label className="search-field">
        <span className="sr-only">Search guests</span>
        <i aria-hidden="true">⌕</i>
        <input
          type="search"
          placeholder="Search guest name"
          value={query}
          maxLength={120}
          onChange={(event) => {
            setQuery(event.target.value);
            setFeedback(null);
          }}
        />
      </label>

      <section className="guest-filters" aria-labelledby="guest-filters-title">
        <p id="guest-filters-title" className="eyebrow">Filter guests</p>
        <label className="search-field" htmlFor="guest-referee-filter">
          <span className="sr-only">Filter by referee name</span>
          <i aria-hidden="true">⌕</i>
          <input
            id="guest-referee-filter"
            aria-label="Filter by referee name"
            placeholder="Referee name"
            value={refereeFilter}
            maxLength={120}
            onChange={(event) => {
              setRefereeFilter(event.target.value);
              setFeedback(null);
            }}
          />
        </label>
        <div className="guest-type-filters" aria-label="Filter by ticket type">
          {([
            ["ALL", "All"],
            ["VIP", "VIP"],
            ["GENERAL", "General"],
          ] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={ticketTypeFilter === value ? "active" : ""}
              aria-pressed={ticketTypeFilter === value}
              onClick={() => {
                setTicketTypeFilter(value);
                setFeedback(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      {feedback && <div className={`guest-feedback ${feedback.tone}`} role="status">{feedback.message}</div>}
      {loadError && <div className="guest-feedback danger" role="alert">{loadError}</div>}

      <section aria-labelledby="guest-results-title">
        <div className="section-label-row">
          <p id="guest-results-title" className="eyebrow">{isLoading ? "Loading guests…" : `${guests.length} guests shown`}</p>
        </div>
        <div className="guest-list" aria-busy={isLoading}>
          {guests.map((guest) => (
            <button
              key={guest.ticketId}
              className={`guest-row ${selectedId === guest.ticketId ? "selected" : ""}`}
              onClick={() => {
                setSelectedId(guest.ticketId);
                setFeedback(null);
              }}
            >
              <span className="guest-initials" aria-hidden="true">{initials(guest.guestName)}</span>
              <span className="guest-summary">
                <strong>{guest.guestName}</strong><small>{guest.refereeName || "No referee"} · {guest.ticketType} · Ticket #{guest.ticketId}</small>
              </span>
              <span className={`arrival-state ${guest.status === "CHECKED_IN" ? "arrived" : guest.status === "CANCELLED" ? "voided" : "waiting"}`}>
                <i />{statusLabel(guest)}{guest.status === "CHECKED_IN" && guest.checkedInAt ? ` · ${checkinDateTime(guest.checkedInAt)}` : ""}
              </span>
            </button>
          ))}
          {!isLoading && guests.length === 0 && !loadError && (
            <div className="empty-state"><strong>No guests found</strong><span>Try the beginning of another guest name.</span></div>
          )}
        </div>
      </section>

      {selectedGuest && (
        <section className="guest-detail" aria-labelledby="guest-detail-title">
          <div className="detail-top">
            <span className="guest-initials large" aria-hidden="true">{initials(selectedGuest.guestName)}</span>
            <div><p className="eyebrow">Guest detail</p><h2 id="guest-detail-title">{selectedGuest.guestName}</h2></div>
          </div>
          <dl>
            <div><dt>Ticket</dt><dd>#{selectedGuest.ticketId}</dd></div>
            <div><dt>Referee</dt><dd>{selectedGuest.refereeName || "Not specified"}</dd></div>
            <div><dt>Type</dt><dd>{selectedGuest.ticketType}</dd></div>
            <div><dt>Purchase date</dt><dd>{formatJalaliDate(selectedGuest.createdAt)}</dd></div>
            <div>
              <dt>Status</dt>
              <dd className={selectedGuest.status === "CHECKED_IN" ? "green-text" : selectedGuest.status === "CANCELLED" ? "orange-text" : ""}>
                {statusLabel(selectedGuest)}{selectedGuest.status === "CHECKED_IN" && selectedGuest.checkedInAt ? ` · ${checkinDateTime(selectedGuest.checkedInAt)}` : ""}
              </dd>
            </div>
          </dl>
          {canManualCheckIn ? (
            <button
              className="button button-primary"
              type="button"
              disabled={selectedGuest.status !== "NOT_ARRIVED" || manualTicketId !== null || managingTicketId !== null}
              onClick={() => void manualCheckIn(selectedGuest)}
            >
              {manualTicketId === selectedGuest.ticketId
                ? "Checking in…"
                : selectedGuest.status === "CANCELLED"
                  ? "Ticket cancelled"
                  : selectedGuest.status === "CHECKED_IN"
                    ? "Already checked in"
                    : "Manual check-in"}
            </button>
          ) : (
            <p className="permission-note">Scanner accounts can search guests. Manual check-in requires an admin.</p>
          )}
          {canManageTickets && (
            <button
              className={selectedGuest.status === "CANCELLED" ? "button button-secondary" : "button button-danger"}
              type="button"
              disabled={managingTicketId !== null || manualTicketId !== null}
              onClick={() => selectedGuest.status === "CANCELLED"
                ? void manageTicket(selectedGuest, "restore")
                : setCancelCandidate(selectedGuest)}
            >
              {managingTicketId === selectedGuest.ticketId
                ? "Updating ticket…"
                : selectedGuest.status === "CANCELLED"
                  ? "Restore Ticket"
                  : "Cancel Ticket"}
            </button>
          )}
        </section>
      )}

      {cancelCandidate && (
        <div className="confirmation-backdrop" role="presentation">
          <section className="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-ticket-title">
            <p className="eyebrow">Ticket cancellation</p>
            <h2 id="cancel-ticket-title">Cancel ticket for &quot;{cancelCandidate.guestName}&quot;?</h2>
            <p>Their existing QR code will no longer be accepted.</p>
            <div>
              <button className="button button-secondary" type="button" onClick={() => setCancelCandidate(null)}>Keep Ticket</button>
              <button className="button button-danger" type="button" onClick={() => void manageTicket(cancelCandidate, "cancel")}>Cancel Ticket</button>
            </div>
          </section>
        </div>
      )}
    </AppShell>
  );
}
