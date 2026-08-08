import { type FormEvent, useEffect, useRef, useState } from "react";
import { AppShell } from "../components/AppShell";
import { ticketTemplatePath } from "../config/ticketLayout";
import { renderTicketImage, ticketDownloadName } from "../lib/ticketImage";
import { requestWithTimeout } from "../lib/request";

type Ticket = {
  id: number;
  token: string;
  guestName: string;
  ticketType: string;
  createdAt: string;
  voidedAt: string | null;
};

export function AdminPage() {
  const [name, setName] = useState("");
  const [ticketType, setTicketType] = useState("General admission");
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isImageReady, setIsImageReady] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const submittingRef = useRef(false);

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
    if (!guestName || submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setMessage("");
    setIsSubmitting(true);
    try {
      const response = await requestWithTimeout("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestName, ticketType }),
      });
      const body = await response.json() as { ticket?: Ticket; error?: string };
      if (!response.ok || !body.ticket) {
        if (response.status === 401 || response.status === 403) {
          setError("Your admin session has expired. Sign in again.");
        } else if (body.error === "invalid_guest_name") {
          setError("Enter a guest name between 1 and 120 characters.");
        } else {
          setError("The ticket could not be created. Try again.");
        }
        return;
      }
      setTicket(body.ticket);
      setMessage(`Ticket #${body.ticket.id} created for ${body.ticket.guestName}.`);
    } catch {
      setError("Couldn’t connect. Check your signal and try again.");
    } finally {
      submittingRef.current = false;
      setIsSubmitting(false);
    }
  }

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
          <span className="step-number">01</span>
          <div>
            <h2 id="ticket-form-title">Guest details</h2>
            <p>Create one admission ticket at a time.</p>
          </div>
        </div>
        <form onSubmit={generateTicket} className="stack-form">
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
            aria-invalid={Boolean(error)}
          />
          <label htmlFor="ticket-type">Ticket type</label>
          <select id="ticket-type" value={ticketType} onChange={(event) => setTicketType(event.target.value)}>
            <option>General admission</option>
            <option>VIP</option>
          </select>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary" type="submit" disabled={!name.trim() || isSubmitting}>
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
