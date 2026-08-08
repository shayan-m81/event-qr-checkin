import { describe, expect, it } from "vitest";
import { ScanGuard } from "./scanGuard";

describe("scanner frame debounce", () => {
  it("allows only one request while a frame is processing", () => {
    const guard = new ScanGuard();
    expect(guard.begin(" pt_12345678901234567890 ", 1_000)).toBe("pt_12345678901234567890");
    expect(guard.begin("pt_other12345678901234567890", 1_001)).toBeNull();
  });

  it("suppresses the same decoded token during the debounce window", () => {
    const guard = new ScanGuard(4_000);
    expect(guard.begin("pt_12345678901234567890", 1_000)).toBeTruthy();
    guard.ready();
    expect(guard.begin("pt_12345678901234567890", 4_999)).toBeNull();
    expect(guard.begin("pt_12345678901234567890", 5_000)).toBeTruthy();
  });
});
