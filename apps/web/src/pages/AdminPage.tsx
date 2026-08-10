import { type FormEvent, useEffect, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ticketTemplatePath } from "../config/ticketLayout";
import { renderTicketImage, ticketDownloadName } from "../lib/ticketImage";
import { requestWithTimeout } from "../lib/request";

type Ticket = {
  id: number;
  token: string;
  guestName: string;
  refereeName: string;
  ticketType: string;
  createdAt: string;
  voidedAt: string | null;
};

function uniqueRefereeNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.filter((name) => {
    const key = name.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function AdminPage() {
  const [name, setName] = useState("");
  const [refereeName, setRefereeName] = useState("");
  const [ticketType, setTicketType] = useState("General admission");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [refereeNames, setRefereeNames] = useState<string[]>([]);
  const [showRefereeSuggestions, setShowRefereeSuggestions] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImageReady, setIsImageReady] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const submittingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    requestWithTimeout("/api/tickets")
      .then(async (response) => {
        const body = await response.json() as { tickets?: Ticket[]; refereeNames?: string[] };
        if (!response.ok) throw new Error("ticket_list_failed");
        if (!cancelled) {
          setRefereeNames(uniqueRefereeNames(body.refereeNames ?? body.tickets?.map((item) => item.refereeName) ?? []));
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!ticket || !canvasRef.current) return;
    let cancelled = false;
    setIsImageReady(false);
    renderTicketImage(canvasRef.current, ticket)
      .then(() => {
        if (!cancelled) setIsImageReady(true);
      })
      .catch(() => {
        if (!cancelled) setError("The ticket was saved, but its preview could not be rendered.");
      });
    return () => { cancelled = true; };
  }, [ticket]);

  async function generateTicket(event: FormEvent) {
    event.preventDefault();
    const guestName = name.trim();
    const normalizedRefereeName = refereeName.trim();
    if (!guestName || !normalizedRefereeName || submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      const response = await requestWithTimeout("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName, refereeName: normalizedRefereeName, ticketType }),
      });
      const body = await response.json() as { ticket?: Ticket; error?: string };
      if (!response.ok || !body.ticket) {
        if (response.status === 401 || response.status === 403) {
          setError("Your admin session has expired. Sign in again.");
        } else if (body.error === "invalid_guest_name") {
          setError("Enter a guest name between 1 and 120 characters.");
        } else if (body.error === "invalid_referee_name") {
          setError("Enter a referee name between 1 and 120 characters.");
        } else {
          setError("The ticket could not be created. Try again.");
        }
        return;
      }
      const createdTicket = body.ticket;
      setTicket(createdTicket);
      setRefereeNames((current) => uniqueRefereeNames([...current, createdTicket.refereeName]));
      setMessage(`Ticket #${createdTicket.id} created for ${createdTicket.guestName}.`);
    } catch {
      setError("Couldn’t connect. Check your signal and try again.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

  const matchingRefereeNames = refereeNames.filter((referee) =>
    referee.toLocaleLowerCase().includes(refereeName.trim().toLocaleLowerCase()),
  ).slice(0, 8);
  function downloadTicket() {
    if (!ticket || !canvasRef.current || !isImageReady) return;
    canvasRef.current.toBlob((blob) => {
      if (!blob) {
        setError("This browser could not create the PNG.");
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = ticketDownloadName(ticket.guestName);
      link.click();
      URL.revokeObjectURL(objectUrl);
    }, "image/png");
  }

  return (
    <AppShell
      eyebrow="Party admin"
      title="Create a ticket"
    >
      <section className="card form-card" aria-labelledby="ticket-form-title">
        <div className="section-heading">
          <div>
            <h2 id="ticket-form-title">Guest details</h2>
            <p>Create one admission ticket at a time.</p>
          </div>
        </div>
        <form onSubmit={generateTicket} className="stack-form">
          <div className="ticket-person-fields">
            <div className="ticket-field">
              <label htmlFor="guest-name">Guest name</label>
              <input
                id="guest-name"
                placeholder="Guest name"
                value={name}
                maxLength={120}
                onChange={(event) => {
                  setName(event.target.value);
                  setError("");
                }}
              />
            </div>
            <div
              className="ticket-field referee-field"
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setShowRefereeSuggestions(false);
              }}
            >
              <label htmlFor="referee-name">Referee name</label>
              <input
                id="referee-name"
                placeholder="Referee name"
                value={refereeName}
                maxLength={120}
                autoComplete="off"
                aria-autocomplete="list"
                aria-controls="referee-suggestions"
                aria-expanded={showRefereeSuggestions && matchingRefereeNames.length > 0}
                onFocus={() => setShowRefereeSuggestions(true)}
                onChange={(event) => {
                  setRefereeName(event.target.value);
                  setShowRefereeSuggestions(true);
                  setError("");
                }}
              />
              {showRefereeSuggestions && matchingRefereeNames.length > 0 && (
                <ul id="referee-suggestions" className="referee-suggestions" role="listbox" aria-label="Previously used referee names">
                  {matchingRefereeNames.map((referee) => (
                    <li key={referee}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={referee === refereeName}
                        onClick={() => {
                          setRefereeName(referee);
                          setShowRefereeSuggestions(false);
                        }}
                      >
                        {referee}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <label htmlFor="ticket-type">Ticket type</label>
          <select id="ticket-type" value={ticketType} onChange={(event) => setTicketType(event.target.value)}>
            <option>General admission</option>
            <option>VIP</option>
          </select>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" type="submit" disabled={!name.trim() || !refereeName.trim() || isSubmitting}>
            {isSubmitting ? "Creating ticket…" : "Generate Ticket"} {!isSubmitting && <span aria-hidden="true">✦</span>}
          </button>
        </form>
      </section>

      <section className="preview-section" aria-labelledby="ticket-preview-title">
        <div className="section-label-row">
          <p id="ticket-preview-title" className="eyebrow">Ticket preview</p>
          <span className="mock-badge">{ticket ? "Saved" : "Waiting"}</span>
        </div>
        {ticket ? (
          <canvas
            ref={canvasRef}
            className="ticket-canvas"
            aria-label={`Ticket preview for ${ticket.guestName}`}
          />
        ) : (
          <div className="ticket-artwork-placeholder">
            <img src={ticketTemplatePath} alt="" />
            <div><strong>Your ticket will appear here</strong><span>Enter a guest name to generate it.</span></div>
          </div>
        )}
        <button
          className="button button-secondary download-button"
          type="button"
          disabled={!ticket || !isImageReady}
          onClick={downloadTicket}
        >
          DOWNLOAD PNG <span aria-hidden="true">↓</span>
        </button>
        {message && <p className="inline-note" role="status">{message}</p>}
      </section>

    </AppShell>
  );
}
