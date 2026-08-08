import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentCameraReadiness, verifyCameraReadiness } from "./cameraReadiness";

beforeEach(() => sessionStorage.clear());

describe("camera readiness", () => {
  it("reports permission required before an explicit successful check", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
    Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: vi.fn().mockResolvedValue({ state: "prompt" }) } });
    await expect(currentCameraReadiness()).resolves.toBe("PERMISSION_REQUIRED");
  });

  it("reports denied permission", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn() } });
    Object.defineProperty(navigator, "permissions", { configurable: true, value: { query: vi.fn().mockResolvedValue({ state: "denied" }) } });
    await expect(currentCameraReadiness()).resolves.toBe("PERMISSION_DENIED");
  });

  it("verifies a video input and stops the stream immediately", async () => {
    const stop = vi.fn();
    const stream = { getVideoTracks: () => [{ stop }], getTracks: () => [{ stop }] } as unknown as MediaStream;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue(stream),
        enumerateDevices: vi.fn().mockResolvedValue([{ kind: "videoinput" }]),
      },
    });
    await expect(verifyCameraReadiness()).resolves.toBe("READY");
    expect(stop).toHaveBeenCalledTimes(1);
    await expect(currentCameraReadiness()).resolves.toBe("READY");
  });

  it("distinguishes no camera and generic camera errors", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException("missing", "NotFoundError")) },
    });
    await expect(verifyCameraReadiness()).resolves.toBe("NO_CAMERA_FOUND");
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error("busy")) },
    });
    await expect(verifyCameraReadiness()).resolves.toBe("CAMERA_ERROR");
  });
});
