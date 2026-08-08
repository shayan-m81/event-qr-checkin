import { describe, expect, it, vi } from "vitest";
import { checkServiceWorkerReadiness } from "./serviceWorkerReadiness";

class FakeMessageChannel {
  port1: { onmessage: ((event: MessageEvent) => void) | null } = { onmessage: null };
  port2 = {
    postMessage: (data: unknown) => this.port1.onmessage?.({ data } as MessageEvent),
  };
}

describe("Service Worker readiness", () => {
  it("fails when no Service Worker is registered", async () => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue(undefined), controller: null },
    });
    await expect(checkServiceWorkerReadiness()).resolves.toMatchObject({ registered: false, controlled: false, shellCached: false });
  });

  it("requires the expected controller and a positive shell-cache response", async () => {
    vi.stubGlobal("MessageChannel", FakeMessageChannel);
    const controller = {
      scriptURL: `${location.origin}/sw.js`,
      postMessage: vi.fn((_message, ports: Array<{ postMessage: (data: unknown) => void }>) => {
        ports[0].postMessage({ type: "READINESS_RESULT", shellCached: true, missing: [] });
      }),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue({ active: controller }), controller },
    });
    await expect(checkServiceWorkerReadiness()).resolves.toEqual({
      registered: true, controlled: true, shellCached: true, missing: [], detail: undefined,
    });
  });
});
