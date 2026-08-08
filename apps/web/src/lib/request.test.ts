import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestTimeoutError, requestWithTimeout } from "./request";

afterEach(() => vi.useRealTimers());

describe("request timeout boundary", () => {
  it("aborts a stalled request at the deadline", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const request = requestWithTimeout("/api/test", {}, 50, fetchMock);
    const expectation = expect(request).rejects.toBeInstanceOf(RequestTimeoutError);
    await vi.advanceTimersByTimeAsync(50);
    await expectation;
  });

  it("propagates caller cancellation without calling it a timeout", async () => {
    const caller = new AbortController();
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }));
    const request = requestWithTimeout("/api/test", { signal: caller.signal }, 8_000, fetchMock);
    caller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });
});
