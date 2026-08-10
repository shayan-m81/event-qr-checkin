import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const buildId = new Date().toISOString()
  .replace(/[-:]/g, "")
  .replace("T", "-")
  .slice(0, 13);
const offlineGrantPublicKeySpki = readFileSync(
  new URL("./offline-grant-public.spki.b64", import.meta.url),
  "utf8",
).trim();

if (!/^MFkw[A-Za-z0-9+/]+={0,2}$/.test(offlineGrantPublicKeySpki)) {
  throw new Error("apps/web/offline-grant-public.spki.b64 must contain a valid base64 P-256 SPKI public key");
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: "offline-shell-manifest",
      generateBundle(_options, bundle) {
        const files = Object.values(bundle)
          .map((entry) => `/${entry.fileName}`)
          .filter((file) => file.endsWith(".js") || file.endsWith(".css"));
        this.emitFile({
          type: "asset",
          fileName: "offline-shell.json",
          source: JSON.stringify({ files }),
        });
      },
    },
  ],
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId),
    __OFFLINE_GRANT_PUBLIC_KEY_SPKI__: JSON.stringify(offlineGrantPublicKeySpki),
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    // Browser IndexedDB is one shared per-origin database; serialize files that exercise it.
    fileParallelism: false,
  },
});
