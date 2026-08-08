import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("public/sw.js", "utf8");

describe("service worker API exclusion", () => {
  it("returns before respondWith for every /api/* request", () => {
    const apiGuard = source.indexOf('url.pathname === "/api"');
    const respondWith = source.indexOf("event.respondWith");
    expect(apiGuard).toBeGreaterThan(-1);
    expect(respondWith).toBeGreaterThan(apiGuard);
  });

  it.each(["/api/auth/session", "/api/auth/login", "/api/auth/logout", "/api/offline/grant"])("does not add %s to the shell cache", (path) => {
    expect(source).not.toContain(`\"${path}\"`);
  });

  it("pre-caches built assets and answers shell readiness messages", () => {
    expect(source).toContain("cacheApplicationShell");
    expect(source).toContain("/offline-shell.json");
    expect(source).toContain("validShellFiles");
    expect(source).toContain('type !== "READINESS_CHECK"');
    expect(source).toContain('type: "READINESS_RESULT"');
  });
});
