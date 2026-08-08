import "@testing-library/jest-dom/vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

beforeEach(() => {
  // Each browser test starts with its own origin storage, avoiding cross-test writes
  // from long-lived scanner effects while preserving persistence within the test.
  vi.stubGlobal("indexedDB", new IDBFactory());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
