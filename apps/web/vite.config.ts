import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const buildId = new Date().toISOString()
  .replace(/[-:]/g, "")
  .replace("T", "-")
  .slice(0, 13);

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, process.cwd(), "");
  return {
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
    __OFFLINE_GRANT_PUBLIC_KEY_SPKI__: JSON.stringify(environment.OFFLINE_GRANT_PUBLIC_KEY_SPKI ?? ""),
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test/setup.ts",
    // Browser IndexedDB is one shared per-origin database; serialize files that exercise it.
    fileParallelism: false,
  },
  };
});
