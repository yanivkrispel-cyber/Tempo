/// <reference types="vitest/config" />
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";

// Writes the API origin into dist/_worker.js (SL-9): the Pages worker serves link previews to crawlers and needs the
// API base, which comes from the same VITE_API_URL the app is built with. Unset, the worker only passes through.
function tempoPreviewWorker(): Plugin {
  let apiUrl = "";
  let outDir = "dist";
  return {
    name: "tempo-preview-worker",
    apply: "build",
    configResolved(config) {
      apiUrl = (loadEnv(config.mode, config.envDir || process.cwd(), "VITE_").VITE_API_URL ?? "").replace(/\/+$/, "");
      outDir = join(config.root, config.build.outDir);
    },
    closeBundle() {
      const file = join(outDir, "_worker.js");
      if (!existsSync(file)) return;
      writeFileSync(file, readFileSync(file, "utf8").replace("__TEMPO_API_URL__", apiUrl));
    },
  };
}

// Static build only (ADR-0009, ADR-0024). Port 5174 matches CLIENT_APP_URL's
// default in the API, so local invitation and join links open this app.
export default defineConfig({
  plugins: [react(), tempoPreviewWorker()],
  // For the first screen's budget (tools/scripts/bundle-budget.mjs), which deletes it after reading.
  build: { manifest: true },
  server: { port: 5174, strictPort: true },
  preview: { port: 5174, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    css: false,
  },
});
