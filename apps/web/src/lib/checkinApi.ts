export type CheckinState = "VALID" | "ALREADY_USED" | "INVALID" | "VOIDED";

export type CheckinResponse = {
  state: CheckinState;
  guestName?: string;
  ticketType?: string;
  checkedInAt?: string;
  checkedInCount: number;
};

export class CheckinApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "CheckinApiError";
  }
}

export const ticketTokenPattern = /^pt_[A-Za-z0-9_-]{20,128}$/;

export function isTicketToken(token: string): boolean {
  return ticketTokenPattern.test(token);
}

export async function submitCheckin(
  token: string,
  timeoutMs = 8_000,
  fetchImplementation: typeof fetch = fetch,
): Promise<CheckinResponse> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImplementation("/api/checkin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
      signal: controller.signal,
    });
    if (!response.ok) throw new CheckinApiError("Check-in API rejected the request.", response.status);
    const body = await response.json() as Partial<CheckinResponse>;
    if (
      !body.state ||
      !["VALID", "ALREADY_USED", "INVALID", "VOIDED"].includes(body.state) ||
      typeof body.checkedInCount !== "number"
    ) {
      throw new CheckinApiError("Check-in API returned an invalid response.");
    }
    return body as CheckinResponse;
  } catch (error) {
    if (error instanceof CheckinApiError) throw error;
    if (controller.signal.aborted) throw new CheckinApiError("Check-in request timed out.");
    throw new CheckinApiError("Check-in API is unavailable.");
  } finally {
    globalThis.clearTimeout(timeout);
  }
}
