import { afterEach, describe, expect, it, vi } from "vitest";
import { CheckinApiError, submitCheckin } from "./checkinApi";

afterEach(() => vi.useRealTimers());

describe("check-in API client", () => {
  it("submits only the ticket token and accepts an authoritative result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: "VALID",
      guestName: "Maya Chen",
      ticketType: "VIP",
      checkedInAt: "2026-08-08T00:00:00.000Z",
      checkedInCount: 1,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    await expect(submitCheckin("pt_test", 8_000, fetchMock)).resolves.toMatchObject({ state: "VALID" });
    expect(fetchMock).toHaveBeenCalledWith("/api/checkin", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ token: "pt_test" }),
    }));
  });

  it("turns non-success API responses into connection errors", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(submitCheckin("pt_test", 8_000, fetchMock)).rejects.toEqual(
      expect.objectContaining<Partial<CheckinApiError>>({ name: "CheckinApiError", status: 503 }),
    );
  });

  it("aborts an API request at the configured timeout", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const result = submitCheckin("pt_test", 50, fetchMock);
    const expectation = expect(result).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
  });
});
