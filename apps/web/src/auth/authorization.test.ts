import { describe, expect, it } from "vitest";
import { canAccessRoute, routePermissions } from "./authorization";

describe("route permission matrix", () => {
  it("matches the product role matrix", () => {
    expect(routePermissions).toEqual({
      "/admin": ["ADMIN"],
      "/scan": ["ADMIN", "PRIMARY_SCANNER", "SECONDARY_SCANNER"],
      "/guests": ["ADMIN", "PRIMARY_SCANNER", "SECONDARY_SCANNER"],
      "/readiness": ["ADMIN", "PRIMARY_SCANNER"],
    });
    expect(canAccessRoute("ADMIN", "/scan")).toBe(true);
    expect(canAccessRoute("PRIMARY_SCANNER", "/admin")).toBe(false);
    expect(canAccessRoute("SECONDARY_SCANNER", "/admin")).toBe(false);
    expect(canAccessRoute("ADMIN", "/readiness")).toBe(true);
    expect(canAccessRoute("PRIMARY_SCANNER", "/readiness")).toBe(true);
    expect(canAccessRoute("SECONDARY_SCANNER", "/readiness")).toBe(false);
  });
});
