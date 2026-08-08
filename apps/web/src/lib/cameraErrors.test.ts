import { describe, expect, it } from "vitest";
import { cameraErrorMessage } from "./cameraErrors";

describe("camera errors", () => {
  it.each([
    ["NotAllowedError", "permission was denied"],
    ["SecurityError", "permission was denied"],
    ["NotFoundError", "No compatible camera"],
    ["OverconstrainedError", "No compatible camera"],
    ["NotReadableError", "busy or unavailable"],
  ])("gives actionable copy for %s", (name, message) => {
    expect(cameraErrorMessage(new DOMException("camera", name))).toContain(message);
  });
});
